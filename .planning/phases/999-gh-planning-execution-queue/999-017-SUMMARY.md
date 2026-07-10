---
phase: 999
plan: 999-017
subsystem: api
tags:
  - vpn-provisioning
  - alert-service
  - user-sync
  - ui-enhancement
dependency_graph:
  requires:
    - alert-service.ts
    - user-sync.ts
    - vpn-services.ts
  provides:
    - vpn-provisioning-failure-recovery
  affects:
    - user-creation-workflow
    - user-list-ui
tech_stack:
  added:
    - per-user sync endpoint POST /api/users/[id]/sync
  patterns:
    - compensating-transaction
    - automatic-retry
    - ui-notification
key_files:
  created:
    - src/app/api/users/[id]/sync/route.ts
  modified:
    - src/app/api/users/route.ts
    - src/components/users/user-list.tsx
    - src/hooks/use-users.ts
    - src/app/api/__tests__/users-db.test.ts
decisions:
  - "Option A selected: Background retry via alert + sync trigger (no schema changes)"
  - "Alert created on partial VPN provisioning failure with WARNING severity"
  - "Automatic syncUser retry triggered immediately on failure"
  - "Alert auto-resolved when retry succeeds"
  - "Per-user sync endpoint added for manual re-sync"
  - "Warning badge added to user list for partially-provisioned users"
metrics:
  duration_seconds: 813
  completed_date: 2026-06-18T04:19:22Z
  commits: 4
  files_created: 1
  files_modified: 4
  tests_passing: 594
  tests_failing: 0
---

# Phase 999 Plan 999-017: Quick Task 260609 - User Creation DB↔VPN Consistency Summary

Implement compensating actions for partial VPN provisioning failures during user creation. Uses existing alert + sync infrastructure (Option A) — no schema changes required.

## Implementation Summary

### Task 1: Create WARNING Alert on VPN Provisioning Failure

**File:** `src/app/api/users/route.ts`
- Added imports: `createAlert`, `AlertSeverity`, `syncUser`, `markAlertRead`
- After VPN service loop, check `!allVpnSuccess`
- Create WARNING alert with type `'vpn-provisioning'` and descriptive message
- Log alert ID for traceability
- Alert includes list of failed services (e.g., "AWG, THREE_XUI")

**Commit:** `cc62384`

### Task 2: Trigger syncUser Retry + Per-User Sync Endpoint

**Files Modified:** `src/app/api/users/route.ts`
**Files Created:** `src/app/api/users/[id]/sync/route.ts`

#### Automatic Retry (route.ts POST handler)
- After alert creation, trigger `syncUser(user.id)` as immediate retry
- If retry succeeds (`report.errors.length === 0`), resolve alert via `markAlertRead()`
- If retry fails or throws, alert remains visible
- Retry is fire-and-forget from API response perspective

#### Per-User Sync Endpoint (new file)
- Route: `POST /api/users/[id]/sync`
- Validates user ID, checks user exists
- Calls `syncUser(userId)` and returns `SyncReport`
- Uses `apiHandler` pattern for consistency

**Commit:** `0e8b018`

### Task 3: Provisioning Warning Badge + Re-sync Button

**Files Modified:** `src/app/api/users/route.ts`, `src/components/users/user-list.tsx`, `src/hooks/use-users.ts`

#### API Changes (route.ts GET handler)
- Removed `where: { isActive: true }` filter from protocols query
- Now includes all protocols (active + inactive) to detect partial provisioning
- Added `hasPartialProvisioning` field: `user.protocols.some(p => !p.isActive)`
- Computed `activeServices` separately from only active protocols

#### UI Changes (user-list.tsx)
- Added imports: `TriangleAlert`, `RefreshCw` from lucide-react
- Added `hasPartialProvisioning` to `UserItem` interface
- Added `syncLoadingId` state for re-sync button loading state
- Added `handleResync` callback function with fetch to `/api/users/${userId}/sync`
- Status column: Show `TriangleAlert` icon (yellow) for users with partial provisioning
- Actions column: Added re-sync button with `RefreshCw` icon
- Re-sync triggers `fetch()` with `POST` method, refetches user list on success

#### Type Changes (use-users.ts)
- Added `hasPartialProvisioning: boolean` to `UserListItem` interface

**Commit:** `c61c8b5`

### Test Update

**File Modified:** `src/app/api/__tests__/users-db.test.ts`
- Updated `fakeUser()` to include `isActive: true` in protocols array
- Updated `UserListBody` type to include `hasPartialProvisioning` field
- Updated test assertion to check `hasPartialProvisioning === false`

**Commit:** `94a88e1`

## Deviations from Plan

None - plan executed exactly as written.

## Auth Gates

None encountered.

## Threat Flags

None introduced.

## Self-Check: PASSED

- [x] Task 1 committed (cc62384)
- [x] Task 2 committed (0e8b018)
- [x] Task 3 committed (c61c8b5)
- [x] Test fix committed (94a88e1)
- [x] All commits exist in git log
- [x] TypeScript compiles (tsc --noEmit passes)
- [x] All tests pass (594/594)
- [x] No linting errors
- [x] No formatting errors
- [x] Files created: `src/app/api/users/[id]/sync/route.ts`
- [x] Files modified: route.ts, user-list.tsx, use-users.ts, users-db.test.ts

## Performance Metrics

- **Duration:** 13m 33s (813 seconds)
- **Commits:** 4
- **Files Created:** 1
- **Files Modified:** 4
- **Tests:** 594 passing, 0 failing
- **TypeScript:** Compiles without errors
- **Linting:** 0 errors, 0 warnings (excluding pre-existing warnings in unrelated files)
