---
phase: 999
plan: 999-006
status: complete
started: "2026-06-14T00:00:00Z"
updated: "2026-06-14T00:00:00Z"
---

# Summary: Architectural Review Follow-ups (2026-06-08)

## What was done

Executed the merged architectural-review artifact. Before implementing, each
proposal was verified against the live codebase (review-audit-self-decision
rule: verified decisions are sticky). One proposal was found already
addressed; two remained valid and were implemented.

### Proposal disposition

| # | Proposal | Status against live code |
|---|----------|--------------------------|
| 2 | chain-router silent Prisma fallback + no-op `__setDeps` | **Implemented** — still fully valid |
| 1 | Lib module test coverage (user-sync, vpn-services) | **Implemented** for two priority modules |
| 3 | vpn-services stub success responses | **Already resolved** — see below |

### Proposal #2 — chain-router dependency injection (implemented)

`generateChainConfig` dynamically imported Prisma with a silent `catch {}`,
silently defaulting the WireGuard port to 51820 when the client was missing.
Its own `__setDeps`/`__resetDeps` were no-ops, so service-port resolution was
untestable.

- Replaced the silent catch with a `console.warn` that surfaces the import
  failure cause, so a misconfigured database client is visible in production
  instead of silently diverging to the default port.
- Added a `ChainRouterServicePortLookup` override surface and made
  `__setDeps`/`__resetDeps` actually register it. Per-server AWG port
  resolution is now testable without a live database.
- Production behavior is unchanged when no override is injected: the real
  Prisma client is loaded, the lookup runs, and failures still fall back to
  51820.

### Proposal #1 — lib module test coverage (implemented)

Added test coverage for the two highest-priority untested business-logic
modules from the artifact, following the codebase's existing pure-logic test
convention (`node:test`, no live DB).

- `vpn-services.test.ts` (15 cases): username sanitization and error wrapping
  across all eight AWG/3x-ui CRUD functions. Invalid usernames fail fast at
  `sanitizeUsername` (before any CLI/DB call) and are wrapped as structured
  `{ success: false, message }` results rather than thrown. A valid-username
  case confirms the sanitizer accepts clean input and the failure comes from
  the CLI layer, not validation.
- `user-sync.test.ts` (6 cases): added a `__setDeps` DI seam (consistent with
  transport-resolver and the new chain-router hook) so the reconciliation
  matrix is testable. Covers the exact scenarios the artifact flagged:
  blocked→VPN block, active→VPN unblock, no-protocols warning, user-not-found,
  VPN-failure error handling, and unknown-protocol skipping.

### Proposal #3 — vpn-services stub success responses (already resolved)

The artifact described `createAwgUser` returning `STUB_PUBLIC_KEY`-style fake
data with `success: true`. The live `vpn-services.ts` no longer contains that
path: it has real `awg` CLI integration (`generateAwgKeyPair`,
`allocateAwgAddress`, `addAwgPeer`) and wraps failures as
`{ success: false }`. The `/api/users` route already reports per-service VPN
status (`vpnServiceStatus`, `vpnAllSuccess`) and logs failures. No code change
needed — the deployment-correctness gap the artifact flagged has already been
closed. (`server-connection.ts` SSH stubs remain, but are out of this
proposal's vpn-services scope.)

## Key files

### key-files.modified
- `src/lib/chain-router.ts` — Injected `ChainRouterServicePortLookup` override; replaced silent Prisma catch with a warning log; made `__setDeps`/`__resetDeps` register the override
- `src/lib/user-sync.ts` — Added `__setDeps`/`__resetDeps` DI seam (`SyncUser`, `UserSyncDeps`); routed `syncUser` through resolvable deps
- `src/lib/__tests__/chain-router.test.ts` — Added DI service-port-resolution tests (2 cases)

### key-files.created
- `src/lib/__tests__/vpn-services.test.ts` — Username sanitization + error-wrapping coverage (15 cases)
- `src/lib/__tests__/user-sync.test.ts` — Reconciliation matrix coverage (6 cases)

### key-files.verified-unchanged
- `src/lib/vpn-services.ts` — Real CLI integration already in place; no stub-success path remains
- `src/app/api/users/route.ts` — Already handles VPN service failures and reports `vpnAllSuccess`

## Deviations

- Skipped a third chain-router test that asserted the "Prisma unavailable"
  warning fires: with the generated client present (CI state), the dynamic
  import succeeds, so the warning cannot be forced without fragile module
  mocking. The warning path is verified in source; the two deterministic tests
  prove the DI fix.
- Proposal #1 lists five priority modules; only `vpn-services` and `user-sync`
  were covered in this run to stay within the wave's turn budget. Remaining
  untested modules (`service-monitor`, `resource-monitor`, `alert-service`,
  `rollback-manager`, `tailscale`, `real-time-broadcaster`) can follow the
  established pattern in later waves.

## Self-Check: PASSED

- All proposals verified against the live codebase before implementation
- `npm test`: 490 tests pass (baseline 470; +20 net from this work, no regressions)
- ESLint: clean on all five changed files
- Prettier: passes on all five changed files
