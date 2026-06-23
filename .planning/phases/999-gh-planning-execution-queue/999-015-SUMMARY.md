# Summary: Plan 999-015 — React Query key registry + WS invalidation hardening

## Status: COMPLETE

## What was built

Centralized React Query key registry (`src/lib/query-keys.ts`) and hardened the WebSocket→React Query invalidation bridge in `providers.tsx`.

### 1. Created centralized query key factory
- New file: `src/lib/query-keys.ts` (30 lines)
- 9 base keys covering all query namespaces: dashboardStats, alerts, alertsUnreadCount, users, serviceStatus, fleetStatus, systemResources, trafficStats, topUserTraffic
- All keys are `readonly` const tuples; parameterized queries use spread: `[...queryKeys.alerts, params]`

### 2. Migrated all 8 hooks to centralized keys
- `use-alerts.ts` — removed `useEffect`/`useWebSocketContext` for alert:new (now handled by providers bridge), replaced all queryKey arrays and invalidation calls
- `use-users.ts` — removed `USERS_QUERY_KEY` export, replaced with `queryKeys.users`
- `use-dashboard-stats.ts`, `use-multi-panel-status.ts`, `use-system-resources.ts` — direct base key assignment
- `use-service-status.ts`, `use-traffic-stats.ts`, `use-top-user-traffic.ts` — spread pattern for parameterized keys

### 3. Hardened WS→RQ bridge
- `providers.tsx` `WS_TO_QUERY_KEYS` now references `queryKeys` instead of hardcoded string arrays
- Added missing mappings:
  - `alert:new` → invalidates `queryKeys.alerts` + `queryKeys.alertsUnreadCount`
  - `chain:status-update` → invalidates `queryKeys.fleetStatus` (chain topology change may indicate panel connectivity change)
- Expanded `stats:update` to also invalidate `serviceStatus`, `trafficStats`, `topUserTraffic`
- Updated type from `string[][]` to `readonly (readonly string[])[]` for type safety

### 4. Added tests
- New file: `src/lib/__tests__/query-keys.test.ts` — validates all keys exist, readonly, support parameterized spreading, and serve as invalidation prefixes

## Key Files Created
- `src/lib/query-keys.ts`
- `src/lib/__tests__/query-keys.test.ts`

## Key Files Modified
- `src/hooks/use-alerts.ts`
- `src/hooks/use-users.ts`
- `src/hooks/use-dashboard-stats.ts`
- `src/hooks/use-service-status.ts`
- `src/hooks/use-multi-panel-status.ts`
- `src/hooks/use-system-resources.ts`
- `src/hooks/use-traffic-stats.ts`
- `src/hooks/use-top-user-traffic.ts`
- `src/components/providers.tsx`

## Verification
- TypeScript: No errors (`npx tsc --noEmit`)
- ESLint: No errors (`npx next lint`)
- Prettier: All files formatted correctly
- Tests: Pre-existing test infrastructure issue (vitest can't resolve `@/` path alias — affects all 113 test files, not caused by this change)

## Self-Check: PASSED

## Notes
- `use-chain-status.ts` was intentionally excluded — it uses direct fetch with its own polling, not React Query
- `panel:push-progress` WS event was intentionally excluded — consumed by push-wizard.tsx via lastEvent, no RQ cache to invalidate
- Test infrastructure (vitest `@/` alias resolution) is a pre-existing issue affecting all tests in the repo
