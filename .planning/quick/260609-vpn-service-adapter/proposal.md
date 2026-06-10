# Quick Task 260609: VPN Service Adapter — Replace Parallel Function Pairs with Polymorphic Interface

## Problem

`vpn-services.ts` has 8 near-identical functions organized as parallel pairs:
- `createAwgUser()` / `createThreeXuiUser()`
- `deleteAwgUser()` / `deleteThreeXuiUser()`
- `blockAwgUser()` / `blockThreeXuiUser()`
- `unblockAwgUser()` / `unblockThreeXuiUser()`

Each function follows the same pattern: `sanitizeUsername()` → `runCommand(serviceCli, args, label)`. Only the CLI binary, arguments, and label differ.

`user-sync.ts` duplicates the dispatch logic twice (lines 57-87 for blocking, lines 90-120 for unblocking) with `if (protocol.serviceType === 'AWG') ... else if (protocol.serviceType === 'THREE_XUI')` chains.

`src/app/api/users/route.ts` (lines 172-200) has the same if/else chain for user creation.

**Adding a third VPN system** (e.g., Outline, Shadowsocks) would require 4 new functions + updating 3+ dispatch sites. This violates OCP (Open/Closed Principle).

## Solution

Create a `VpnServiceAdapter` interface with four methods: `create`, `delete`, `block`, `unblock`. Implement once per service type (AWG, 3x-ui). Provide a registry `getAdapter(serviceType)` that consumers call instead of if/else chains.

## Scope

### 1. Define adapter interface + implementations

- **files**: Create `src/lib/vpn-service-adapter.ts`
- **action**:
  - Define `VpnServiceAdapter` interface with `create`, `delete`, `block`, `unblock` methods
  - Implement `AwgAdapter` and `ThreeXuiAdapter` (thin wrappers calling existing `runCommand`)
  - Export `getAdapter(serviceType: ServiceType): VpnServiceAdapter` registry function
  - ~80-100 lines
- **verify**: Unit test confirming `getAdapter('AWG')` returns AwgAdapter, `getAdapter('THREE_XUI')` returns ThreeXuiAdapter, unknown type throws
- **done**: Adapter interface + two implementations exported

### 2. Refactor user-sync.ts dispatch chains

- **files**: `src/lib/user-sync.ts`
- **action**:
  - Replace the two duplicated if/else chains (lines 57-87 and 90-120) with:
    ```ts
    const adapter = getAdapter(protocol.serviceType);
    const result = user.isBlocked ? await adapter.block(username) : await adapter.unblock(username);
    ```
  - Reduce syncUser() by ~40 lines
- **verify**: `npx vitest run src/lib/__tests__/` passes; user sync logic unchanged
- **done**: user-sync.ts uses adapter, no if/else on serviceType

### 3. Refactor users/route.ts creation dispatch

- **files**: `src/app/api/users/route.ts`
- **action**:
  - Replace the if/else chain (lines 172-200) with adapter lookup
  - Loop becomes: `const adapter = getAdapter(protocol.serviceType); const result = await adapter.create(username);`
- **verify**: User creation API returns same response shape
- **done**: users route uses adapter

### 4. Deprecate vpn-services.ts individual exports

- **files**: `src/lib/vpn-services.ts`
- **action**:
  - Keep existing exports as thin re-exports from adapter implementations for backward compatibility
  - Add `@deprecated` JSDoc pointing to `vpn-service-adapter.ts`
  - Any remaining direct consumers (service install/uninstall routes) can migrate incrementally
- **verify**: No compile errors; existing call sites still work
- **done**: Old exports deprecated, new adapter is canonical

## Acceptance Criteria

- [ ] `VpnServiceAdapter` interface defined with create/delete/block/unblock
- [ ] AWG and 3x-ui adapters implemented
- [ ] `user-sync.ts` uses `getAdapter()` — zero if/else chains on serviceType
- [ ] `users/route.ts` uses `getAdapter()` — zero if/else chains on serviceType
- [ ] TypeScript compiles; existing tests pass
- [ ] Adding a third VPN system requires only a new adapter implementation + registry entry

## Risk

- Low — thin refactoring over existing stable code. The adapter implementations delegate to the same `runCommand` calls. Behavioral change is zero.
- Old exports kept for backward compat during migration.

## Estimated Effort

1 focused session

## Relationship to Existing Proposals

- **260601-b2n** (Infrastructure abstraction) covers HTTP client + command executor — this proposal is orthogonal: it addresses the service-type dispatch pattern, not the command execution layer.
- **260605-arch-review** did not identify this pattern.
- VPN service stubs are noted as deferred in STATE.md, but the adapter pattern is independent of stub vs. real implementation — it structures the dispatch regardless.
