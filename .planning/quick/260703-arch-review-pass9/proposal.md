# Architectural Review Pass 9 (2026-07-03)

Source: `/gsd:explore` ninth-pass review (non-duplicative vs proposals #1-#24 and open PRs).

## Deduplication Check

Excluded topics already covered by open PRs or existing proposals:
- VPN service adapter polymorphism (#460)
- Typed API client for frontend (#459)
- User creation DB↔VPN consistency (#444)
- Schema hygiene/migrations (#439)
- Chain-router key generation (#442)
- Dependabot grouping (#567)
- ESLint bump (#561)
- All proposals #1-#24 in ROADMAP.md

## Proposals

### #25: Alert table unbounded growth — no retention cleanup

**Severity:** Medium (Ops)
**Area:** `src/lib/alert-service.ts`, `src/lib/real-time-broadcaster.ts`

**Problem:**
`TrafficLog` has a 90-day retention cleanup (`traffic-log-cleanup.ts` runs daily via the broadcaster). The `Alert` table has no equivalent. Quota alerts alone generate 3 entries per user per threshold crossing (80%, 90%, 100%), and duplicate suppression only works within a 1-hour window (`quota-monitor.ts:110`). With 50 users and monthly quota resets, alerts accumulate at ~150+ entries/month minimum — service alerts and resource alerts add more. Over a year this is thousands of rows with no cleanup.

**Proposed change:**
Add `cleanupOldAlerts()` to `alert-service.ts` (modeled on `cleanupOldTrafficLogs()`), configurable via `ALERT_RETENTION_DAYS` env var (default 90). Call it from the same daily cleanup interval in `startBroadcaster()`.

**Benefit:** Bounded alert storage; prevents slow `getAlerts()` queries and unbounded SQLite file growth.

---

### #26: Broken CIDR matching in `enforceXrayRules`

**Severity:** High (Correctness)
**Area:** `src/lib/rule-enforcement.ts:31`

**Problem:**
`enforceXrayRules()` matches destination IPs with `destIp.startsWith(rule.value.split('/')[0])`. This is not CIDR matching — it is a string prefix check that produces false positives. For example:
- Rule `192.168.1.0/24` → `startsWith("192.168.1.0")` matches `192.168.10.0` (false positive)
- Rule `10.0.0.0/8` → `startsWith("10.0.0.0")` does NOT match `10.1.2.3` (false negative)

The function is used by `applyRoutingRules()` and `applyAllRules()`, so any Xray routing rule with a CIDR destination is incorrectly evaluated.

**Proposed change:**
Replace the `startsWith` check with a proper CIDR subnet matching function (e.g., `ipaddr.js` or a small `parseCIDR(mask)` utility that extracts the network bits and does `(ip AND mask) === network`). The `ipaddr.js` library is already a transitive dependency of Next.js/Socket.IO.

**Benefit:** Correct IP-based routing rule enforcement; eliminates false positives/negatives in the Xray rule application path.

---

### #27: Geo-routing rule DB cache — repeated full-table scans per resolution

**Severity:** Medium (Perf)
**Area:** `src/lib/geo-routing.ts:104`, `src/lib/panel-health-checker.ts`

**Problem:**
`evaluateGeoRulesFromDB()` calls `prisma.geoRoutingRule.findMany({ where: { isActive: true } })` on every invocation. This is called from `resolveGeoRoute()`, which is invoked per-destination in the rule enforcement and chain-router paths. With 100+ imported geo rules (e.g., full v2fly geoip.dat import), each resolution re-reads the entire active rule set from SQLite. The `panel-health-checker` also calls `findMany` for panels 4 separate times in its check cycle.

**Proposed change:**
Add a simple TTL-based in-memory cache (e.g., 60s expiry) for `evaluateGeoRulesFromDB()` — store the typed rules array and invalidate on rule CRUD (create, update, delete, reorder). Pattern: `let cachedRules: { data: GeoRoutingRule[], expiry: number } | null = null;`. Same pattern applicable to panel-health-checker's repeated panel list loads.

**Benefit:** Eliminates redundant DB round-trips in geo-routing hot path; reduces per-resolution latency from a full table scan to an in-memory array filter.
