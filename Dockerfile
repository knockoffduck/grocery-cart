# =============================================================================
# Aldi Cart PWA — minimal Bun production Dockerfile
# =============================================================================
#
# Two-stage build on oven/bun:slim (Debian bookworm). Bun replaces both npm
# (dependency install) and Node (runtime) and runs server.ts directly as
# TypeScript — so there is no separate `tsc` compile step and no dist/
# artefact. Dokploy/Traefik terminate TLS in front of the container; the
# image still serves HTTPS on 7778 when certs are mounted (LAN iOS use).
#
# Why this is small and fast:
#   * No native modules (better-sqlite3 was removed in the PocketBase
#     migration), so no python3/make/g++ build tools are needed anywhere.
#   * `bun install` is dramatically faster than `npm ci`.
#   * The runner installs production deps only — no typescript, eslint,
#     tsx, tailwindcss or @types/* — and runs server.ts natively.
#
# Note on output mode: `output: "standalone"` cannot be combined with a
# custom server (Next.js does not trace custom-server files in standalone
# mode), so the runner ships production node_modules and runs server.ts.
#
# Build:  docker build -t aldi-cart:latest .
# Run:    docker run --rm -p 3000:3000 aldi-cart:latest
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: builder — install all deps, pre-compile CSS, build Next.js
# -----------------------------------------------------------------------------
FROM oven/bun:slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS builder

WORKDIR /app

# Manifest + lockfile + scripts first so the (slow-ish) install layer is
# cached until dependencies actually change. `bun install` runs the
# postinstall hook (scripts/copy-wasm.sh) which drops the ZBar WASM assets
# into public/.
COPY package.json bun.lock ./
COPY scripts/ ./scripts/
RUN mkdir -p public && bun install --frozen-lockfile

# Application source.
COPY next.config.ts tsconfig.json tailwind.config.js postcss.config.mjs ./
COPY src ./src
COPY server.ts ./
# Overlay the committed public files (sw.js, icons). The WASM assets are
# already present from the postinstall hook; COPY merges, it does not prune.
COPY public ./public

# Pre-compile Tailwind CSS via the standalone API. This bypasses the
# @tailwindcss/postcss plugin, whose scanner does not find source files
# inside the Next.js webpack build. Same script `npm run build:css` uses.
RUN bun scripts/tailwind-standalone.mjs \
    src/app/globals.css \
    src/app/globals.compiled.css

# Build Next.js. `--webpack` is required: Turbopack is the Next 16 default
# but the custom-server path only works with the webpack build.
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun ./node_modules/next/dist/bin/next build --webpack

# -----------------------------------------------------------------------------
# Stage 2: runner — production deps + build artefacts, no build tools
# -----------------------------------------------------------------------------
FROM oven/bun:slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.ts reads HTTP_PORT / HTTPS_PORT / HOST (not PORT). Kept aligned
# with the source so Dokploy env-var injection matches what the server uses.
ENV HTTP_PORT=3000
ENV HTTPS_PORT=7778
ENV HOST=0.0.0.0

# Production dependencies only. `--ignore-scripts` skips the WASM-copy
# postinstall (public/ is copied wholesale from the builder below). Bun
# runs server.ts natively, so no typescript/tsx is needed at runtime.
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

# Build artefacts. .next/cache, /trace and /dev are build-time only and are
# pruned so they don't bloat the runtime image.
COPY --from=builder /app/.next ./.next
RUN rm -rf .next/cache .next/trace .next/dev
COPY --from=builder /app/public ./public
# The custom server source — Bun executes TypeScript directly.
COPY server.ts ./

# TLS cert directory. Mounted as a volume so the LAN HTTPS cert survives
# image upgrades. (The database is PocketBase, external to this container.)
RUN mkdir -p /app/certs
VOLUME ["/app/certs"]

# Dokploy/Traefik forward HTTP; HTTPS is available for direct mapping.
EXPOSE 3000 7778

# Health check: poll /api/health using bun's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Bun runs the custom server directly (TypeScript, no compile step). Bun
# forwards SIGTERM/SIGINT to the script, which has its own graceful-shutdown
# handler in server.ts.
CMD ["bun", "server.ts"]
