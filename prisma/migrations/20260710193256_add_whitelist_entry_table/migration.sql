-- CreateTable
CREATE TABLE "whitelist_entries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "serverId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_admins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_admins" ("createdAt", "id", "password", "updatedAt", "username") SELECT "createdAt", "id", "password", "updatedAt", "username" FROM "admins";
DROP TABLE "admins";
ALTER TABLE "new_admins" RENAME TO "admins";
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");
CREATE TABLE "new_user_quotas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quotaBytes" INTEGER NOT NULL DEFAULT 0,
    "period" TEXT NOT NULL DEFAULT 'MONTHLY',
    "resetAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "user_quotas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_quotas" ("id", "period", "quotaBytes", "resetAt", "updatedAt", "userId") SELECT "id", "period", "quotaBytes", "resetAt", "updatedAt", "userId" FROM "user_quotas";
DROP TABLE "user_quotas";
ALTER TABLE "new_user_quotas" RENAME TO "user_quotas";
CREATE UNIQUE INDEX "user_quotas_userId_key" ON "user_quotas"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "whitelist_entries_type_isActive_idx" ON "whitelist_entries"("type", "isActive");

-- CreateIndex
CREATE INDEX "whitelist_entries_serverId_idx" ON "whitelist_entries"("serverId");
