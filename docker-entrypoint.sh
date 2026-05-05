#!/bin/sh
set -e

# Run Prisma migrations before starting the app.
# On first run the database is empty; on subsequent runs only new
# migrations are applied.  --schema bypasses prisma.config.ts (which
# needs dotenv) and --skip-generate avoids rebuilding the client (it
# was already generated during the Docker build step).
echo "[entrypoint] Applying database migrations…"
npx prisma migrate deploy --schema /app/prisma/schema.prisma --skip-generate

echo "[entrypoint] Starting application…"
exec "$@"
