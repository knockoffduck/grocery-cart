#!/usr/bin/env bash
# docker-entrypoint.sh
#
# Container startup for the ALDI Cart Next.js server.
# 1. Optionally probe Postgres reachability. `nc` is not installed in the
#    minimal Node image, so this is a soft warning, not a blocker — the
#    src/lib/db.ts module will surface the real connection error on the
#    first request if the DB is genuinely unreachable.
# 2. `exec` the Node server so it replaces this shell and inherits PID 1,
#    letting SIGTERM/SIGINT reach the graceful-shutdown handler in server.ts.
set -euo pipefail

if command -v nc >/dev/null 2>&1; then
  if ! nc -z database-grocerycart-l0kdmu 5432; then
    echo "[entrypoint] WARN: Postgres unreachable at database-grocerycart-l0kdmu:5432"
  fi
fi

exec node dist/server.js
