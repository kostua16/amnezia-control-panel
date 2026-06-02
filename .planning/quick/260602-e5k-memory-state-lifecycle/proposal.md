# Quick Task 260602-e5k: In-memory state lifecycle management

## Problem

Multiple lib modules maintain module-level `Map`/`Set`/`Interval` state with no bounds and no cleanup hooks:

- **`panel-health-checker.ts:27`** — `panelApiKeyCache = new Map<number, string>()` stores **plaintext API keys in memory indefinitely**. No cleanup when a panel is deleted or deactivated. Keys entered during manual config push stay in memory forever.
- **`panel-health-checker.ts:25-26`** — `consecutiveFailures` and `fallbackPanels` maps are never cleared when panels are deleted from the DB.
- **`server-connection.ts:19`** — `connectionPool = new Map<number, ConnectionPoolEntry>()` has TTL but no max-size bound. With rapid server add/remove cycles, stale entries accumulate until TTL expires.
- **`real-time-broadcaster.ts:5-6`** — `setInterval` refs are module-level. If the server starts but WebSocket init fails, intervals run forever with no health check.
- **`geoip-manager.ts`** — Loads entire GeoIP country database into a `Map` at module scope (~250 countries). The map is rebuilt on refresh but the old one has no explicit cleanup trigger.

## Scope

### 1. Evict in-memory state on panel deletion
- **files**: `src/lib/panel-health-checker.ts`
- **action**:
  - Export `evictPanel(panelId: number)` that clears from `consecutiveFailures`, `fallbackPanels`, and `panelApiKeyCache`
  - Call from panel DELETE route (`src/app/api/panels/[id]/route.ts`) after DB delete succeeds
  - Add max-age to `panelApiKeyCache` entries (evict after 1 hour)
- **verify**: Create panel → push config → delete panel → check `panelApiKeyCache` no longer contains key
- **done**: Panel deletion cleans up all in-memory state

### 2. Bound connection pool size
- **files**: `src/lib/server-connection.ts`
- **action**:
  - Add `MAX_POOL_SIZE = 100` constant
  - When pool exceeds limit, evict oldest entry (LRU by `lastUsed`)
  - Consider replacing with a simple bounded cache class
- **verify**: Add 200 mock entries → pool size stays at 100
- **done**: Connection pool has hard upper bound

### 3. Register cleanup hooks for intervals
- **files**: `src/lib/real-time-broadcaster.ts`, `src/lib/panel-health-checker.ts`
- **action**:
  - Export `cleanup()` or `dispose()` functions that clear intervals and flush state
  - Register via `process.on('SIGTERM', ...)` in the server startup script (`server.mjs`)
  - Prevent orphan intervals on graceful shutdown
- **verify**: Send SIGTERM to running server → no "interval callback after shutdown" errors in logs
- **done**: All intervals have cleanup hooks tied to process lifecycle

## Acceptance Criteria
- [ ] Panel deletion evicts all associated in-memory state
- [ ] API key cache has 1-hour max-age
- [ ] Connection pool bounded at 100 entries
- [ ] All intervals registered for cleanup on SIGTERM
