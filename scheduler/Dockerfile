# =============================================================================
# Aldi Cart — Scheduler Service Dockerfile
# =============================================================================
#
# Lightweight Bun service that periodically runs the sync pipeline
# (Aldi sync → OFF sync → match). Shares the same source tree as the
# main app but runs only the scheduler entrypoint.
#
# Build:  docker build -f scheduler/Dockerfile -t aldi-cart-scheduler:latest .
# Run:    docker run --rm -p 3001:3001 aldi-cart-scheduler:latest
# =============================================================================

FROM oven/bun:slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04

WORKDIR /app
ENV NODE_ENV=production

# Install production deps (pocketbase, undici are the key ones for sync)
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

# Copy source needed by the sync runners
COPY src/lib ./src/lib
COPY scripts/sync-off.ts ./scripts/sync-off.ts
COPY scheduler/main.ts ./scheduler/main.ts

ENV SCHEDULE_PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.SCHEDULE_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "scheduler/main.ts"]
