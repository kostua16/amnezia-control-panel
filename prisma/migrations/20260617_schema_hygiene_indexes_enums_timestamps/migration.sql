-- SchemaHygiene: add missing models, performance indexes, enum-backed columns, updatedAt timestamps
-- Generated: 2026-06-17
-- Scope: covers drift from 20260428191601_init + 20260611000000_add_audit_logs + 20260614000000_add_traffic_log_user_timestamp_index

-- AddColumn: Admin.updatedAt. SQLite rejects ALTER TABLE ... ADD COLUMN with a
-- non-constant default (CURRENT_TIMESTAMP) as soon as the table holds rows
-- ("Cannot add a column with non-constant default"), so the column is added by
-- redefining the table instead, matching the RedefineTables block below.
-- Existing admin credentials are carried over by the INSERT ... SELECT, with
-- updatedAt seeded from createdAt. DROP TABLE also drops the @unique(username)
-- index admins_username_key created by the init migration, so it is recreated.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_admins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_admins" ("createdAt", "id", "password", "username", "updatedAt") SELECT "createdAt", "id", "password", "username", "createdAt" FROM "admins";
DROP TABLE "admins";
ALTER TABLE "new_admins" RENAME TO "admins";
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable: ConfigTemplate
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

-- CreateTable: GeoRoutingRule
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
    "source" TEXT NOT NULL DEFAULT 'CUSTOM',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: RoutingRuleTemplate
CREATE TABLE "routing_rule_templates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'GEO',
    "ruleCount" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: ChainPreset
CREATE TABLE "chain_presets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "topology" TEXT NOT NULL DEFAULT 'LINEAR',
    "nodeCount" INTEGER NOT NULL DEFAULT 2,
    "chainTemplateId" TEXT NOT NULL,
    "routingBundleId" TEXT,
    "protocolOverrides" JSONB,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AddColumn: UserQuota.updatedAt. Same SQLite restriction as "admins" above:
-- ADD COLUMN with a non-constant default fails once the table holds rows, so the
-- table is redefined instead. Unlike alerts/routing_rules/servers/services, the
-- source "user_quotas" table has no "createdAt" column, so seed "updatedAt" with
-- CURRENT_TIMESTAMP — referencing a nonexistent column here aborts the migration
-- at parse time, after earlier tables were already dropped/renamed. DROP TABLE
-- also drops the user_quotas_userId_key unique index from the init migration, so
-- it is recreated, and the user_quotas_userId_fkey constraint is carried over.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_user_quotas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quotaBytes" INTEGER NOT NULL DEFAULT 0,
    "period" TEXT NOT NULL DEFAULT 'MONTHLY',
    "resetAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "user_quotas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_quotas" ("id", "period", "quotaBytes", "resetAt", "updatedAt", "userId") SELECT "id", "period", "quotaBytes", "resetAt", CURRENT_TIMESTAMP, "userId" FROM "user_quotas";
DROP TABLE "user_quotas";
ALTER TABLE "new_user_quotas" RENAME TO "user_quotas";
CREATE UNIQUE INDEX "user_quotas_userId_key" ON "user_quotas"("userId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable: RemotePanel
CREATE TABLE "remote_panels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "panelUrl" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable: PanelConnectionHistory
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

-- CreateTable: CachedPanelConfig
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

-- RedefineTables: add updatedAt to alerts, routing_rules, servers, services, user_protocols
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- alerts: add updatedAt
CREATE TABLE "new_alerts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_alerts" ("createdAt", "id", "isRead", "message", "severity", "type", "updatedAt") SELECT "createdAt", "id", "isRead", "message", "severity", "type", "createdAt" FROM "alerts";
DROP TABLE "alerts";
ALTER TABLE "new_alerts" RENAME TO "alerts";
CREATE INDEX "alerts_isRead_idx" ON "alerts"("isRead");
CREATE INDEX "alerts_severity_idx" ON "alerts"("severity");
CREATE INDEX "alerts_createdAt_idx" ON "alerts"("createdAt");

-- routing_rules: add updatedAt
CREATE TABLE "new_routing_rules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "protocol" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'ALLOW',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" INTEGER,
    CONSTRAINT "routing_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_routing_rules" ("action", "createdAt", "destination", "id", "isActive", "priority", "protocol", "userId", "updatedAt") SELECT "action", "createdAt", "destination", "id", "isActive", "priority", "protocol", "userId", "createdAt" FROM "routing_rules";
DROP TABLE "routing_rules";
ALTER TABLE "new_routing_rules" RENAME TO "routing_rules";
CREATE INDEX "routing_rules_userId_idx" ON "routing_rules"("userId");
CREATE INDEX "routing_rules_priority_idx" ON "routing_rules"("priority");

-- servers: add tailnetIP, tailnetHostname, dnsName, advertisedSubnets, updatedAt
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_servers" ("apiKeyHash", "createdAt", "hostname", "id", "isActive", "name", "port", "updatedAt") SELECT "apiKeyHash", "createdAt", "hostname", "id", "isActive", "name", "port", "createdAt" FROM "servers";
DROP TABLE "servers";
ALTER TABLE "new_servers" RENAME TO "servers";

-- services: add updatedAt
CREATE TABLE "new_services" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STOPPED',
    "config" JSONB NOT NULL,
    "port" INTEGER,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "serverId" INTEGER NOT NULL,
    CONSTRAINT "services_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_services" ("config", "createdAt", "id", "lastCheckedAt", "port", "serverId", "status", "type", "updatedAt") SELECT "config", "createdAt", "id", "lastCheckedAt", "port", "serverId", "status", "type", "createdAt" FROM "services";
DROP TABLE "services";
ALTER TABLE "new_services" RENAME TO "services";

-- user_protocols: add updatedAt.
-- Unlike alerts/routing_rules/servers/services, the source "user_protocols"
-- table has no "createdAt" column (it was created without one), so seed
-- "updatedAt" with CURRENT_TIMESTAMP instead of copying from a nonexistent
-- column (referencing "createdAt" here aborts the migration at parse time,
-- after earlier tables are already dropped/renamed).
CREATE TABLE "new_user_protocols" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serviceType" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "user_protocols_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_protocols" ("config", "id", "isActive", "protocol", "serviceType", "userId", "updatedAt") SELECT "config", "id", "isActive", "protocol", "serviceType", "userId", CURRENT_TIMESTAMP FROM "user_protocols";
DROP TABLE "user_protocols";
ALTER TABLE "new_user_protocols" RENAME TO "user_protocols";
CREATE UNIQUE INDEX "user_protocols_userId_serviceType_key" ON "user_protocols"("userId", "serviceType");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex: new performance indexes
CREATE INDEX "geo_routing_rules_priority_idx" ON "geo_routing_rules"("priority");
CREATE INDEX "geo_routing_rules_matchType_idx" ON "geo_routing_rules"("matchType");
CREATE INDEX "geo_routing_rules_isActive_idx" ON "geo_routing_rules"("isActive");
CREATE INDEX "geo_routing_rules_source_idx" ON "geo_routing_rules"("source");

CREATE UNIQUE INDEX "remote_panels_panelUrl_key" ON "remote_panels"("panelUrl");

CREATE INDEX "panel_connection_history_panelId_idx" ON "panel_connection_history"("panelId");
CREATE INDEX "panel_connection_history_checkedAt_idx" ON "panel_connection_history"("checkedAt");

CREATE UNIQUE INDEX "cached_panel_configs_panelId_key" ON "cached_panel_configs"("panelId");

CREATE INDEX "configurations_isActive_idx" ON "configurations"("isActive");

CREATE INDEX "services_type_idx" ON "services"("type");
CREATE INDEX "services_status_idx" ON "services"("status");

CREATE INDEX "user_protocols_userId_idx" ON "user_protocols"("userId");
CREATE INDEX "user_protocols_isActive_idx" ON "user_protocols"("isActive");

CREATE INDEX "users_isActive_idx" ON "users"("isActive");
CREATE INDEX "users_isBlocked_idx" ON "users"("isBlocked");
