CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "resourceId" TEXT,
  "actor" TEXT NOT NULL DEFAULT 'admin',
  "outcome" TEXT NOT NULL DEFAULT 'success',
  "metadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_resourceId_idx" ON "audit_logs"("resource", "resourceId");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
