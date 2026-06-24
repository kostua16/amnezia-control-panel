#!/bin/sh
set -e

echo "[stack-entrypoint] Preparing bundled stack directories…"
/docker/stack/scripts/init-stack-dirs.sh

echo "[stack-entrypoint] Applying database migrations…"
cd /app
npx prisma migrate deploy --schema /app/prisma/schema.prisma --skip-generate
chown -R appuser:appgroup /app/data/prisma

echo "[stack-entrypoint] Initializing AWG config (if needed)…"
/docker/stack/scripts/init-awg.sh

echo "[stack-entrypoint] Starting s6 supervision…"
exec /init
