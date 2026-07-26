FROM oven/bun:1 AS base
WORKDIR /app

# Install workspace deps
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY scheduler/package.json scheduler/
RUN bun install --frozen-lockfile --production

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "packages/api/src/index.ts"]
