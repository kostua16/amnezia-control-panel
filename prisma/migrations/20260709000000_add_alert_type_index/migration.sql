-- Index for Alert.type, used by the quota monitor's duplicate check
-- (prisma.alert.findFirst/findMany where type = ...) and any type-based alert
-- query. Without it, each duplicate-check is a full table scan that degrades as
-- alerts accumulate within the retention window.
CREATE INDEX IF NOT EXISTS "alerts_type_idx" ON "alerts"("type");
