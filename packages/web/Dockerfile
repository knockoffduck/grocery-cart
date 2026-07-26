FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY scheduler/package.json scheduler/
RUN bun install --frozen-lockfile
# ZBar WASM decoder is gitignored; copy it from node_modules into public/
# (mirrors the old scripts/copy-wasm.sh postinstall hook)
RUN cp node_modules/web-wasm-barcode-reader/dist/a.out.js node_modules/web-wasm-barcode-reader/dist/a.out.wasm packages/web/public/
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/
RUN cd packages/web && bun run build

FROM nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
