# Quick Task 260602-d4p: Broadcaster throttling + TrafficLog retention

## Problem

**Unthrottled broadcasting:** `real-time-broadcaster.ts` runs 6 Prisma queries every 30 seconds (user counts, traffic aggregation, service counts) and `getSystemResources()` every 10 seconds — regardless of whether any WebSocket client is connected. On a single-admin panel, this means 12+ DB queries per minute that do nothing.

**TrafficLog unbounded growth:** `TrafficLog` rows accumulate with zero retention policy. Two hot paths scan the full table:
- `real-time-broadcaster.ts:29` — `prisma.trafficLog.aggregate({ _sum: { bytesIn, bytesOut } })` runs every 30s
- `stats/traffic/route.ts:86` — `$queryRawUnsafe` with `GROUP BY` over all rows
- `dashboard/stats/route.ts:18` — same aggregate as broadcaster

With 50 users logging traffic every poll interval, this table grows ~50 rows/interval. After months, the aggregate scans become expensive.

## Scope

### 1. Skip broadcaster when no clients connected
- **files**: `src/lib/real-time-broadcaster.ts`, `src/lib/websocket.ts`
- **action**:
  - Add connection tracking in `websocket.ts`: increment/decrement counter on Socket.IO `connection`/`disconnect` events
  - Export `hasConnectedClients(): boolean`
  - In `real-time-broadcaster.ts`, gate both intervals on `hasConnectedClients()` — if no clients, skip the DB queries
- **verify**: Start server with no browser open → no stats queries in logs; open dashboard → queries resume
- **done**: Zero DB queries from broadcaster when no WS clients connected

### 2. Add TrafficLog retention + cleanup
- **files**: Create `src/lib/traffic-log-cleanup.ts`, modify `src/lib/real-time-broadcaster.ts`
- **action**:
  - Create cleanup function: `prisma.trafficLog.deleteMany({ where: { timestamp: { lt: retentionDate } } })` with configurable retention days (default 90)
  - Schedule cleanup once daily from broadcaster startup (not per-push)
  - Add `RETENTION_DAYS` env var with sensible default
- **verify**: Insert old traffic log → run cleanup → old rows deleted; recent rows preserved
- **done**: TrafficLog rows older than 90 days auto-deleted daily

### 3. Cache the traffic aggregate
- **files**: `src/lib/real-time-broadcaster.ts`, `src/app/api/dashboard/stats/route.ts`
- **action**:
  - Compute traffic totals once per broadcaster tick (30s), cache in a module variable
  - Export `getCachedTrafficTotals()` for the dashboard stats API to reuse instead of re-querying
  - Deduplicate the identical aggregate query between broadcaster and API route
- **verify**: Dashboard stats API returns cached data without extra DB query; data stays fresh within 30s
- **done**: Traffic aggregate computed once per tick, reused by API

## Acceptance Criteria
- [ ] Broadcaster skips DB queries when zero WS clients connected
- [ ] TrafficLog rows older than retention period auto-deleted daily
- [ ] Traffic aggregate computed once per tick, cached for API reuse
- [ ] No performance regression in dashboard load time
