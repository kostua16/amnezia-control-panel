-- Unique constraint on Configuration.name.
-- The config import dedup path uses findUnique({ where: { name } }); without a
-- unique index, two configurations sharing a name can coexist and dedup resolves
-- non-deterministically. This index makes import idempotency reliable.
--
-- Deduplicate before building the index: config-generator.ts create()s without a
-- name-collision check, so a database upgraded from a pre-unique schema can
-- already hold multiple rows with the same name, which would make CREATE UNIQUE
-- INDEX abort. Keep the newest row per name (highest id = most recently
-- generated/imported) and delete the rest. This is safe because no other table
-- references the configurations table, so deleting rows cannot orphan anything.
DELETE FROM "configurations"
WHERE id NOT IN (
  SELECT MAX(id) FROM "configurations" GROUP BY "name"
);
CREATE UNIQUE INDEX IF NOT EXISTS "configurations_name_key" ON "configurations"("name");

-- PanelConnectionHistory was removed from the Prisma schema. The table was never
-- populated (no write path existed) and the health checker serves status from an
-- in-memory cache, so drop the now-orphaned table.
DROP TABLE IF EXISTS "panel_connection_history";
