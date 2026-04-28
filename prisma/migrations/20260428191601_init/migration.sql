-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "trafficQuotaBytes" INTEGER NOT NULL DEFAULT 0,
    "speedLimitKbps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "servers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "apiKeyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "services" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STOPPED',
    "config" JSONB NOT NULL,
    "port" INTEGER,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverId" INTEGER NOT NULL,
    CONSTRAINT "services_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "configurations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "serviceId" INTEGER,
    CONSTRAINT "configurations_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "traffic_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bytesIn" INTEGER NOT NULL DEFAULT 0,
    "bytesOut" INTEGER NOT NULL DEFAULT 0,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,
    "serverId" INTEGER NOT NULL,
    CONSTRAINT "traffic_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "traffic_logs_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "routing_rules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "protocol" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'ALLOW',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    CONSTRAINT "routing_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "user_quotas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quotaBytes" INTEGER NOT NULL DEFAULT 0,
    "period" TEXT NOT NULL DEFAULT 'MONTHLY',
    "resetAt" DATETIME,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "user_quotas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_protocols" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serviceType" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "user_protocols_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "traffic_logs_userId_idx" ON "traffic_logs"("userId");

-- CreateIndex
CREATE INDEX "traffic_logs_serverId_idx" ON "traffic_logs"("serverId");

-- CreateIndex
CREATE INDEX "traffic_logs_timestamp_idx" ON "traffic_logs"("timestamp");

-- CreateIndex
CREATE INDEX "routing_rules_userId_idx" ON "routing_rules"("userId");

-- CreateIndex
CREATE INDEX "routing_rules_priority_idx" ON "routing_rules"("priority");

-- CreateIndex
CREATE INDEX "alerts_isRead_idx" ON "alerts"("isRead");

-- CreateIndex
CREATE INDEX "alerts_severity_idx" ON "alerts"("severity");

-- CreateIndex
CREATE INDEX "alerts_createdAt_idx" ON "alerts"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_quotas_userId_key" ON "user_quotas"("userId");

-- CreateIndex
CREATE INDEX "user_protocols_userId_idx" ON "user_protocols"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_protocols_userId_serviceType_key" ON "user_protocols"("userId", "serviceType");
