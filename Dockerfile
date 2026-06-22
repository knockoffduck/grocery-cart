# =============================================================================
# Aldi Cart PWA — production Dockerfile for Dokploy
# =============================================================================
#
# Dokploy builds this Dockerfile and runs the resulting image behind Traefik
# (Dokploy's built-in reverse proxy), which terminates TLS in front of the
# container. The image itself serves plain HTTP on a configurable port and
# the app's HTTPS path is unused in production. The /api/cert endpoint is
# kept around for completeness but only matters in the local LAN scenario.
#
# Multi-stage build:
#   1. `base`     — Node 22 base + system build tools (python3, g++, bash)
#   2. `deps`     — `npm ci` for the full dep tree
#   3. `builder`  — `next build` (webpack) + `tsc` for server.ts
#   4. `runner`   — clean Node 22 (no build tools) that COPIES the
#                   pre-built production node_modules from `prod-deps`, plus
#                   `.next`, `public/`, and `dist/`. The database is an
#                   external Postgres container; no SQLite snapshot is
#                   bundled. Schema bootstrap happens on first request
#                   via src/lib/db.ts.
#
# Why we DON'T use `output: "standalone"` despite enabling it in next.config.ts:
#   Next.js 16's standalone trace doesn't include `next/dist/compiled/webpack/*`
#   when the build is run with `--webpack`, so a standalone-traced custom
#   server crashes at startup with `Cannot find module 'webpack'`. The simplest
#   fix is to ship the full production node_modules (~150 MB runtime cost).
#
# Stage 4's `runner` no longer inherits from `base` (which carries
# python3/make/g++) — it uses a clean `node:22-bookworm-slim` and copies
# pre-built `node_modules` from `prod-deps` instead. This removes ~200 MB
# of build tools from the production image.
#
# Build command (Dokploy does this for you):
#   docker build -t aldi-cart:latest .
# Run locally to verify:
#   docker run --rm -p 3000:3000 \
#     -v aldi-cart-certs:/app/certs:ro \
#     -e PROXY_URL=... \
#     -e DATABASE_URL=postgresql://... \
#     aldi-cart:latest
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: base — Node 22 + system build tools
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2 AS base

# python3 + make + g++ are required by better-sqlite3's native build.
# bash is required by the `postinstall` hook (scripts/copy-wasm.sh).
# ca-certificates ensures HTTPS calls to Aldi / OFF / proxy endpoints work.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates bash \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# -----------------------------------------------------------------------------
# Stage 2: deps — full dep tree for the build (postinstall compiles better-sqlite3)
# -----------------------------------------------------------------------------
FROM base AS deps

# Copy package manifest AND the postinstall script before `npm ci` runs.
# The script copies the ZBar WASM assets from node_modules into public/,
# so it must exist on disk before npm install tries to invoke it.
COPY package.json package-lock.json ./
COPY scripts/ ./scripts/
# `public/` is referenced by the postinstall hook (copy-wasm.sh writes
# a.out.{js,wasm} there). Create the directory so the script doesn't
# fail even if the source files are gitignored.
RUN mkdir -p public

# `npm ci` is the deterministic install — it reads package-lock.json exactly.
# `--legacy-peer-deps` is a safety net in case any future dep adds a peer
# that conflicts. better-sqlite3 triggers a native compile in postinstall.
RUN npm ci --no-audit --no-fund --legacy-peer-deps

# -----------------------------------------------------------------------------
# Stage 2.5: prod-deps — production-only node_modules (no devDeps)
# -----------------------------------------------------------------------------
# Rebuilds against the slim libstdc++ the runner uses, so we don't have
# to copy a prebuilt .node binary from `deps` (which was built with g++
# on PATH). Drops ~1.2 GB of devDependencies (eslint, typescript, tsx,
# @types/*) from the runtime image.
FROM base AS prod-deps

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/ ./scripts/
RUN mkdir -p public
RUN npm ci --omit=dev --no-audit --no-fund --legacy-peer-deps

# -----------------------------------------------------------------------------
# Stage 3: build (Next.js + compiled custom server)
# -----------------------------------------------------------------------------
FROM deps AS builder

# Source for the build. public/ contains the WASM assets that the
# `npm ci` postinstall hook (`scripts/copy-wasm.sh`) just dropped in
# inside the `deps` stage. We copy them from `deps` (not the build
# context) so the build doesn't depend on a populated public/ dir in
# the source tree — Dokploy's fresh-clone build context has an empty
# (or missing) public/ because the WASM files are gitignored.
COPY --from=deps /app/public ./public
COPY next.config.ts tsconfig.json ./
COPY src ./src
COPY server.ts ./

# Compile the custom HTTPS server to plain JS so the runtime image doesn't
# need tsx. esbuild via tsc emits modern ESM that Node 22 runs natively.
# The output is a single self-contained file in dist/server.js.
RUN npx tsc server.ts \
    --target es2022 \
    --module nodenext \
    --moduleResolution nodenext \
    --esModuleInterop \
    --skipLibCheck \
    --outDir dist

# Build the Next.js app.
#
# IMPORTANT: Next.js 16 defaults the build bundler to Turbopack, but
# `output: "standalone"` (which we enable in next.config.ts) only works
# with webpack. We pass `--webpack` to force the webpack-based build.
# Once Turbopack gains standalone-output support this flag can be removed.
#   See: https://nextjs.org/docs/app/api-reference/turbopack
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build --webpack

# -----------------------------------------------------------------------------
# Stage 4: runner (clean production image — no build tools, no devDeps)
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2 AS runner

# libstdc++ is required at runtime by the prebuilt better-sqlite3 .node
# binary. The minimal Debian image doesn't include it by default.
# NOTE: no python3/make/g++ here — those only live in the `base`/
# `deps` stages where better-sqlite3 is built.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

# Run as the unprivileged `node` user that the official image ships.
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.ts reads HTTP_PORT (default 3000) and HTTPS_PORT (default 7778),
# NOT PORT. Kept aligned with the source so Dokploy env-var injection
# matches what the compiled server actually consumes.
ENV HTTP_PORT=3000
ENV HTTPS_PORT=7778
ENV HOST=0.0.0.0

# ---- Build output ----
# .next, public/, and dist/ are the artefacts the compiled server needs
# at runtime. We copy from the builder stage so dev-only files (tests,
# source, tsconfig) never end up in the production image. The .next/cache
# and .next/trace directories are build-time only and are pruned here so
# they don't bloat the image (they're ~100 MB of webpack cache).
COPY --from=builder --chown=node:node /app/.next ./.next
RUN rm -rf /app/.next/cache /app/.next/trace /app/.next/dev
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/dist ./dist

# ---- Entrypoint ----
# scripts/docker-entrypoint.sh runs before the Node server: it
# optionally probes Postgres reachability, then `exec node
# dist/server.js` so SIGTERM reaches the graceful-shutdown handler.
COPY --from=builder --chown=root:root /app/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# ---- Production node_modules ----
# Copy production-only node_modules from the `prod-deps` stage. This
# drops devDependencies (eslint, typescript, tsx, @types/*) — about
# 1.2 GB of bloat that was shipping in earlier builds.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules

# ---- TLS cert directory ----
# The LAN HTTPS cert lives on a mounted volume so it survives container
# restarts and image upgrades. The `node` user owns it so the app can
# read the cert/key files. (The database lives in an external Postgres
# container, so no DB volume is needed here.)
RUN mkdir -p /app/certs && chown -R node:node /app/certs
VOLUME ["/app/certs"]

# Expose both HTTP and HTTPS ports. Dokploy only forwards HTTP; HTTPS is
# kept available for users who want to map the container's TLS port
# directly (e.g. Tailscale Funnel, custom reverse proxy).
EXPOSE 3000 7778

# Switch to the unprivileged user. The node:22-bookworm-slim image ships
# a `node` user with uid 1000.
USER node

# Health check: poll /api/health every 30s. Traefik and Dokploy both honour
# this signal to decide when the container is ready to receive traffic.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.HTTP_PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the compiled custom server. The compiled JS is CJS that requires
# the `next` package from this image's production node_modules. No tsx,
# no source files, no devDependencies at runtime.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
