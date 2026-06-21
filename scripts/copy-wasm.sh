#!/usr/bin/env bash
# Copy the ZBar WASM assets from node_modules into the public/ directory
# so the BarcodeScanner class can fetch them at runtime.
#
# Required because Next.js's public/ folder serves static files at the
# site root, but the WASM assets live in node_modules and aren't included
# automatically.
set -euo pipefail

SRC="node_modules/web-wasm-barcode-reader/dist/a.out.js"
DST_JS="public/a.out.js"
SRC_WASM="node_modules/web-wasm-barcode-reader/dist/a.out.wasm"
DST_WASM="public/a.out.wasm"

if [[ ! -f "$SRC" ]] || [[ ! -f "$SRC_WASM" ]]; then
  echo "[copy-wasm] error: $SRC or $SRC_WASM not found."
  echo "[copy-wasm] run \`npm install\` first."
  exit 1
fi

cp "$SRC" "$DST_JS"
cp "$SRC_WASM" "$DST_WASM"
echo "[copy-wasm] copied $(wc -c < "$DST_JS") bytes to $DST_JS"
echo "[copy-wasm] copied $(wc -c < "$DST_WASM") bytes to $DST_WASM"
