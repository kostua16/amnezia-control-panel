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

-- CreateIndex
CREATE INDEX "whitelist_entries_type_isActive_idx" ON "whitelist_entries"("type", "isActive");

-- CreateIndex
CREATE INDEX "whitelist_entries_serverId_idx" ON "whitelist_entries"("serverId");
