---
plan: 999-023
phase: 999
status: complete
---

# Plan 999-023 Summary: VPN Service Adapter

## What was built

Created a `VpnServiceAdapter` polymorphic interface replacing 8 parallel function pairs and 3 if/else dispatch chains across the codebase.

### Scope items delivered

1. **`src/lib/vpn-service-adapter.ts`** — New file. `VpnServiceAdapter` interface with `create`, `delete`, `block`, `unblock` methods. `AwgAdapter` and `ThreeXuiAdapter` implementations (thin delegates to existing `runCommand`-based functions in vpn-services.ts). `getAdapter(serviceType)` registry function. Unknown type throws `Error`.

2. **`src/lib/user-sync.ts`** — Refactored. `UserSyncDeps` interface simplified from 4 service-specific functions to 2 adapter-aware functions (`blockUser`, `unblockUser`). Two duplicated if/else dispatch chains replaced with single `deps.blockUser`/`deps.unblockUser` calls. `SUPPORTED_SERVICE_TYPES` set guards against unknown protocol types. Tests updated to match new deps shape.

3. **`src/app/api/users/route.ts`** — Refactored. Creation dispatch if/else chain replaced with `getAdapter(protocol.serviceType).create(username)`. Unknown types caught and skipped.

4. **`src/lib/vpn-services.ts`** — All 8 individual exports (`createAwgUser`, `deleteAwgUser`, `blockAwgUser`, `unblockAwgUser`, `createThreeXuiUser`, `deleteThreeXuiUser`, `blockThreeXuiUser`, `unblockThreeXuiUser`) marked `@deprecated` pointing to `vpn-service-adapter.ts`. Exports kept for backward compatibility.

5. **`src/lib/__tests__/vpn-service-adapter.test.ts`** — New test file. 7 tests covering registry correctness (AWG→AwgAdapter, THREE_XUI→ThreeXuiAdapter), unknown type throws, method presence, delegation to vpn-services validation, and singleton stability.

### Deferred

- **Block/unblock routes** (`src/app/api/users/[id]/block/route.ts`, `src/app/api/users/[id]/unblock/route.ts`) — still import deprecated exports directly. These can migrate incrementally per the proposal scope.

## Acceptance criteria status

- [x] `VpnServiceAdapter` interface defined with create/delete/block/unblock
- [x] AWG and 3x-ui adapters implemented
- [x] `user-sync.ts` uses `getAdapter()` — zero if/else chains on serviceType
- [x] `users/route.ts` uses `getAdapter()` — zero if/else chains on serviceType
- [x] TypeScript compiles; all 604 tests pass; lint and Prettier clean
- [x] Adding a third VPN system requires only a new adapter implementation + registry entry

## Self-Check: PASSED

- TypeScript: no errors
- Tests: 604/604 pass
- Lint: clean (0 errors, 3 pre-existing warnings)
- Prettier: clean
