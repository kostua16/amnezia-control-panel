#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."
npx prisma migrate deploy --schema /app/prisma/schema.prisma

echo "[entrypoint] Starting server..."
exec "$@"
