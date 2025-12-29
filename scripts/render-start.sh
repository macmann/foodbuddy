#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required before starting the server. Set DATABASE_URL and rerun." >&2
  exit 1
fi

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Starting Next.js standalone server..."
node .next/standalone/server.js
