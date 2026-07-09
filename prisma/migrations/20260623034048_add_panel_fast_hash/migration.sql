-- Add the apiKeyFastHash column to remote_panels: a SHA-256 fast-hash of the
-- plaintext API key, used for an O(1) indexed lookup before the bcrypt verify
-- in POST /api/sync/receive. Scoped to remote_panels only.
--
-- SQLite cannot ADD COLUMN ... NOT NULL without a default on a populated table,
-- and the plaintext key is not stored so existing rows cannot be recomputed.
-- The table is therefore rebuilt and legacy rows are seeded with a unique,
-- non-matching sentinel ("legacy:<id>") so the migration applies cleanly on
-- upgraded databases. Such legacy panels fail fast-hash lookup (the sentinel
-- never equals a real sha256 digest) until an admin re-keys them; the plaintext
-- cannot be recovered from the stored bcrypt hash.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_remote_panels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "panelUrl" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyFastHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_remote_panels" (
    "id", "name", "panelUrl", "apiKeyHash", "apiKeyFastHash",
    "isActive", "createdAt", "updatedAt"
)
SELECT
    "id", "name", "panelUrl", "apiKeyHash",
    'legacy:' || CAST("id" AS TEXT),
    "isActive", "createdAt", "updatedAt"
FROM "remote_panels";

DROP TABLE "remote_panels";
ALTER TABLE "new_remote_panels" RENAME TO "remote_panels";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE UNIQUE INDEX "remote_panels_panelUrl_key" ON "remote_panels"("panelUrl");
CREATE UNIQUE INDEX "remote_panels_apiKeyFastHash_key" ON "remote_panels"("apiKeyFastHash");
