#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required before starting the server. Set DATABASE_URL and rerun." >&2
  exit 1
fi

echo "Running Prisma migrations..."
if ! migrate_output=$(npx prisma migrate deploy 2>&1); then
  echo "$migrate_output" >&2
  if echo "$migrate_output" | grep -q "P3009"; then
    echo "" >&2
    echo "Prisma detected a failed migration blocking deploy." >&2
    echo "Resolve it with:" >&2
    echo "  npx prisma migrate resolve --rolled-back 20250115000100_add_recommendation_metadata" >&2
  fi
  exit 1
fi

export NODE_OPTIONS="--unhandled-rejections=strict -r ./scripts/register-process-handlers.cjs"

echo "Starting Next.js standalone server..."
npx next start -p "${PORT:-3000}" -H 0.0.0.0
