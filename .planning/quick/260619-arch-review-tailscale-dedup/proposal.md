# Deduplicate Tailscale status calls in transport resolution

## Problem

`resolvePanelTransport()` calls `getNodeIP()` then `isReachable()`, each independently
invoking `tailscale status --json` (a control-plane network call + full JSON parse).

`transport-resolver.ts:68` imports `tailscale.getNodeIP` and `tailscale.isReachable`.
Both internally call `getStatus()` which runs `tailscale status --json` via execFile.

For chain config generation with N nodes (`chain-router.ts:117-177`), `resolvePanelTransport`
is called per node via `Promise.all`, meaning **2N full Tailscale CLI invocations** where N
would suffice.

With 3 nodes: 6 CLI calls → 3. Each `tailscale status --json` takes ~200-500ms including
control-plane round-trip.

## Evidence

- `src/lib/tailscale.ts:195` — `getNodeIP()` calls `runTailscale(['ip', '-4', hostname])`
- `src/lib/tailscale.ts:211` — `isReachable()` calls `getStatus()` → `runTailscale(['status', '--json'])`
- `src/lib/transport-resolver.ts:131` — calls `isReachable(hostnameUsed)` after `getNodeIP()` already resolved via status

Note: `getNodeIP` uses `tailscale ip` not `tailscale status --json`, so the duplication is
between `getNodeIP` (1 CLI call) and `isReachable` (1 CLI call for full status). Both make
separate CLI invocations to the tailscale binary.

## Fix

1. Refactor `isReachable()` in `tailscale.ts` to accept an optional pre-fetched `TailscaleStatus`:
   ```
   isReachable(hostname, status?: TailscaleStatus | null)
   ```
   When provided, skip the `getStatus()` call and search the passed status object.

2. In `transport-resolver.ts`, fetch status once before tier resolution:
   ```
   const status = await getStatus();
   // use status for isReachable check
   ```

3. Update `__setDeps` test interface in `tailscale.ts` and `transport-resolver.ts` to
   support the new overload.

## Impact

- Halves Tailscale CLI invocations during chain generation: 2N → N.
- Reduces chain config generation latency by ~200-500ms per node.
- No behavior change — same resolution logic, fewer CLI calls.
- Low risk: additive optional parameter, backward compatible.

## Files

- `src/lib/tailscale.ts` — add optional status param to `isReachable()`
- `src/lib/transport-resolver.ts` — fetch status once, pass to `isReachable()`
- `src/lib/__tests__/transport-resolver.test.ts` — update test mocks
