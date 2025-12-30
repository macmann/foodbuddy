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
