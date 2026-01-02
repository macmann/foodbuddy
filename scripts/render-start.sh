#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required before starting the server. Set DATABASE_URL and rerun." >&2
  exit 1
fi

# prisma migrate deploy runs in the prestart hook to keep production schemas in sync.

export NODE_OPTIONS="--unhandled-rejections=strict -r ./scripts/register-process-handlers.cjs"
export HOSTNAME="0.0.0.0"
export PORT="${PORT:-10000}"

echo "Checking static asset paths..."
if [[ -d ".next/static" ]]; then
  echo "Found .next/static"
else
  echo "Missing .next/static"
fi

if [[ -d ".next/standalone/.next/static" ]]; then
  echo "Found .next/standalone/.next/static"
else
  echo "Missing .next/standalone/.next/static"
fi

if [[ -d "public" ]]; then
  echo "Found public"
else
  echo "Missing public"
fi

echo "Starting standalone server on ${HOSTNAME}:${PORT}..."
node .next/standalone/server.js
