-- Unique constraint on Configuration.name.
-- The config import dedup path uses findUnique({ where: { name } }); without a
-- unique index, two configurations sharing a name can coexist and dedup resolves
-- non-deterministically. This index makes import idempotency reliable.
CREATE UNIQUE INDEX IF NOT EXISTS "configurations_name_key" ON "configurations"("name");

-- PanelConnectionHistory was removed from the Prisma schema. The table was never
-- populated (no write path existed) and the health checker serves status from an
-- in-memory cache, so drop the now-orphaned table.
DROP TABLE IF EXISTS "panel_connection_history";
