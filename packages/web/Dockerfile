FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY scheduler/package.json scheduler/
RUN bun install --frozen-lockfile
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/
# ZBar WASM decoder is gitignored; copy it from the installed package into
# public/ (mirrors the old scripts/copy-wasm.sh postinstall hook). Uses the
# workspace-local symlink so the version isn't hardcoded. Must run after the
# web source is copied so packages/web/public/ exists.
RUN cp packages/web/node_modules/web-wasm-barcode-reader/dist/a.out.js packages/web/node_modules/web-wasm-barcode-reader/dist/a.out.wasm packages/web/public/
RUN cd packages/web && bun run build

FROM nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
