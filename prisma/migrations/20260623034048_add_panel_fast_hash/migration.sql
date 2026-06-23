-- CreateTable
CREATE TABLE "config_templates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "serviceType" TEXT,
    "protocol" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'protocol',
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "geo_routing_rules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "countryCode" TEXT,
    "region" TEXT,
    "special" TEXT,
    "action" TEXT NOT NULL DEFAULT 'ALLOW',
    "chainId" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "routing_rule_templates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'geo',
    "ruleCount" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "chain_presets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "topology" TEXT NOT NULL DEFAULT 'linear',
    "nodeCount" INTEGER NOT NULL DEFAULT 2,
    "chainTemplateId" TEXT NOT NULL,
    "routingBundleId" TEXT,
    "protocolOverrides" JSONB,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "remote_panels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "panelUrl" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyFastHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "panel_connection_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "success" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "message" TEXT NOT NULL,
    "version" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "panelId" INTEGER NOT NULL,
    CONSTRAINT "panel_connection_history_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "remote_panels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cached_panel_configs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "panelId" INTEGER,
    "configVersion" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousConfigVersion" INTEGER,
    "previousConfig" JSONB,
    "previousConfigReceivedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_servers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "apiKeyHash" TEXT NOT NULL,
    "tailnetIP" TEXT,
    "tailnetHostname" TEXT,
    "dnsName" TEXT,
    "advertisedSubnets" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_servers" ("apiKeyHash", "createdAt", "hostname", "id", "isActive", "name", "port") SELECT "apiKeyHash", "createdAt", "hostname", "id", "isActive", "name", "port" FROM "servers";
DROP TABLE "servers";
ALTER TABLE "new_servers" RENAME TO "servers";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "geo_routing_rules_priority_idx" ON "geo_routing_rules"("priority");

-- CreateIndex
CREATE INDEX "geo_routing_rules_matchType_idx" ON "geo_routing_rules"("matchType");

-- CreateIndex
CREATE INDEX "geo_routing_rules_isActive_idx" ON "geo_routing_rules"("isActive");

-- CreateIndex
CREATE INDEX "geo_routing_rules_source_idx" ON "geo_routing_rules"("source");

-- CreateIndex
CREATE UNIQUE INDEX "remote_panels_panelUrl_key" ON "remote_panels"("panelUrl");

-- CreateIndex
CREATE UNIQUE INDEX "remote_panels_apiKeyFastHash_key" ON "remote_panels"("apiKeyFastHash");

-- CreateIndex
CREATE INDEX "remote_panels_apiKeyFastHash_idx" ON "remote_panels"("apiKeyFastHash");

-- CreateIndex
CREATE INDEX "panel_connection_history_panelId_idx" ON "panel_connection_history"("panelId");

-- CreateIndex
CREATE INDEX "panel_connection_history_checkedAt_idx" ON "panel_connection_history"("checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cached_panel_configs_panelId_key" ON "cached_panel_configs"("panelId");
