-- Composite index for traffic-stats queries that filter by a single user and a
-- timestamp range (e.g. GET /api/stats/traffic?userId=...&startDate=...&endDate=...).
-- SQLite uses one index per query; a (userId, timestamp) index serves both
-- filter dimensions in a single index scan instead of narrowing on one column
-- and table-scanning the other. The single-column indexes above are retained
-- for queries that filter by only one dimension.
CREATE INDEX IF NOT EXISTS "traffic_logs_userId_timestamp_idx" ON "traffic_logs"("userId", "timestamp");
