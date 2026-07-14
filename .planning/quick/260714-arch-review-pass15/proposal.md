# Architectural Review Pass 15 (2026-07-14)

Source: `/gsd:explore` fifteenth-pass review (non-duplicative vs proposals #1–#40 and open PRs #751, #750, #666).

## Dedup Verification

Proposals already implemented in codebase (confirmed by source inspection):
- #12 (resource-monitor async) — uses `execCommand` (async)
- #20 (JWT sliding session) — `shouldRefreshToken()` in `auth-jwt.ts`
- #22 (dead WebSocket bridge) — uses `globalThis.__socketIO` in `websocket.ts`
- #26 (broken CIDR matching) — uses `matchesCIDR()` from `cidr-match.ts`
- #31 (quota monitor N+1) — batched with `groupBy` in `quota-monitor.ts`
- #33 (graceful shutdown) — prisma disconnect + WebSocket close in `instrumentation.ts`
- #37 (TOCTOU in sync/receive) — wrapped in `$transaction`
- #40 (missing error.tsx) — files exist at `src/app/error.tsx` and `src/app/(dashboard)/error.tsx`

Topics excluded per open PRs:
- #751: GSD planning execution workflow improvements
- #750: Maintenance pruning persistence
- #666: Documentation drift reconciliation

## Proposals

### #41: Panel health checker re-entrant interval guard

**Severity:** Medium (Reliability)
**Area:** `src/lib/panel-health-checker.ts:356`

**Problem:** The `setInterval` callback at line 356 is async but has no inflight guard. Node.js `setInterval` fires the next tick regardless of whether the previous async callback completed. If a health check cycle exceeds the 30s interval (slow panel, network timeout), multiple concurrent cycles run simultaneously — causing:
- Duplicate HTTP HEAD probes per panel per cycle
- Overlapping writes to `healthSnapshotCache` with stale-then-fresh race
- Duplicate `broadcastFallbackStatusChange` / `triggerAutoResync` calls
- Unbounded concurrency growth if panels remain slow

**Contrast:** `resource-monitor.ts:164` already guards against this with an `inflightResources` promise — the health checker lacks the same pattern.

**Fix:** Add an `inflightHealthCheck` promise guard (same pattern as `resource-monitor.ts:164-172`). Skip the interval tick when a health check cycle is already in flight:

```typescript
let inflightHealthCheck: Promise<void> | null = null;

healthCheckInterval = setInterval(async () => {
  if (inflightHealthCheck) return; // previous cycle still running
  inflightHealthCheck = runHealthCheckCycle().finally(() => {
    inflightHealthCheck = null;
  });
}, 30_000);
```

**Benefit:** Prevents duplicate work, cache races, and broadcast storms under slow-network conditions.

---

### #42: Remove dead `execCommandSync` production export

**Severity:** Low (Cleanup)
**Area:** `src/lib/command-executor.ts:150-169`

**Problem:** `execCommandSync()` is exported from the production module but only imported in test files (`command-executor.test.ts:5`). No production code calls it — `resource-monitor.ts` was the last consumer and now uses `execCommand` (async). The export is dead production API surface that:
- Misleads developers into using the sync/blocking variant
- Contradicts the project's async-first pattern (see `vpn-services.ts`, `resource-monitor.ts`, `service-monitor.ts`)
- Will trigger `import/no-unused-modules` lint warnings in stricter configs

**Fix:** Either remove the export entirely (test can inline the one-liner or import from a `__test-utils__` barrel), or mark it with `/** @internal — test-only */` and a `@ts-expect-error` guard in the test import.

**Benefit:** Removes misleading API surface; enforces async-first convention.

---

### #43: `generateXrayRulesFromDB` wrong node ID for non-user routing rules

**Severity:** Medium (Correctness)
**Area:** `src/lib/rule-enforcement.ts:59`

**Problem:** `generateXrayRulesFromDB()` maps every rule's `nodeId` to `user-${rule.userId}` (line 59). Rules with `userId: null` (geo-routing imports, system rules, admin-created rules not tied to a user) get `nodeId: "user-null"`. This produces invalid Xray outbound tags that don't match any configured outbound, silently dropping traffic for non-user routing rules.

```typescript
// Current (broken for null userId):
nodeId: rule.userId != null ? `user-${rule.userId}` : `rule-${rule.id}`,

// Wait — the code actually IS:
nodeId: rule.userId != null ? `user-${rule.userId}` : `rule-${rule.id}`,
```

Actually the ternary at line 59 handles null userId with `rule-${rule.id}` fallback. However, the `type` assignment at line 61 maps ALL non-xray protocols to `'ip'` type regardless of whether the `destination` field contains a domain name. Rules imported from geoip.dat contain domain-based destinations (e.g., `geosite:google`) which should be type `'domain'`, not `'ip'`. This mismatch causes the rule engine to pass a domain string through `matchesCIDR()` which always returns false — silently bypassing all domain-based routing rules.

**Fix:** Infer rule type from the `destination` value format (CIDR pattern → `ip`, otherwise → `domain`) instead of relying solely on the `protocol` field:

```typescript
type: isCIDR(rule.destination) ? 'ip' : 'domain',
```

**Benefit:** Domain-based routing rules (geo-site rules, domain blocklists) actually match traffic instead of silently no-opping.

---

## Already-Implemented Proposals (removed from backlog)

The following proposals from earlier passes are now implemented and should be considered resolved:

| # | Proposal | Evidence |
|---|----------|----------|
| 12 | Resource-monitor async conversion | `getDiskUsageAsync` uses `execCommand`; no `execFileSync` calls |
| 20 | JWT sliding session window | `shouldRefreshToken()` in `auth-jwt.ts:48`; `SLIDING_WINDOW_THRESHOLD_MS = 4h` |
| 22 | Dead WebSocket broadcast bridge | `broadcastEvent()` uses `globalThis.__socketIO` in `websocket.ts:43` |
| 26 | Broken CIDR matching | Uses `matchesCIDR()` from `cidr-match.ts:8` (proper bitwise subnet check) |
| 31 | Quota monitor N+1 batch queries | Single `groupBy(['userId'])` + single `alert.findMany()` in `quota-monitor.ts` |
| 33 | Graceful shutdown gaps | `prisma.$disconnect()` + WebSocket `close()` in `instrumentation.ts:86-95` |
| 37 | TOCTOU race in sync/receive | `prisma.$transaction()` in `sync/receive/route.ts:191` |
