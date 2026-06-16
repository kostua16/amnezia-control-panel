---
phase: 999-gh-planning-execution-queue
plan: 999-009
subsystem: infra
tags: [geoip, longest-prefix-match, performance, prisma, real-time, websocket]

# Dependency graph
requires: []
provides:
  - "GeoIP lookup via O(32) longest-prefix-match trie over CIDR ranges"
  - "Dashboard stats bounded to a configurable rolling traffic window with a single user groupBy"
affects: [geoip, real-time-broadcaster, dashboard-stats]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IPv4 longest-prefix-match trie for overlapping/nested CIDR membership"
    - "Prisma groupBy to collapse multiple count() queries into one"

key-files:
  created: []
  modified:
    - src/lib/geoip-manager.ts
    - src/lib/dashboard-stats.ts
    - src/app/api/dashboard/stats/route.ts
    - src/components/dashboard/metrics-cards.tsx
    - src/types/monitoring.ts
    - src/lib/real-time-broadcaster.ts
    - src/lib/__tests__/geoip-manager.test.ts

key-decisions:
  - "Proposal 2 (API handler abstraction) left untouched — already implemented and adopted; see Proposals deferred."
  - "Nested GeoIP ranges use longest-prefix-match semantics; most-specific prefix wins."
  - "Traffic window configurable via TRAFFIC_STATS_WINDOW_HOURS env var, default 24h, and exposed in the dashboard payload."

patterns-established:
  - "Pure exported buildLookupIndex/lookupCountryInIndex so the hot lookup path is unit-testable without the disk-loaded singleton."
  - "Shared getDashboardStats helper keeps initial API fetches and WebSocket updates on the same rolling-window contract."

requirements-completed: []

# Metrics
duration: ~20min
completed: 2026-06-15
---

# Plan 999-009: Architectural Review Follow-up Improvements Summary

**GeoIP lookup cut from O(total_CIDRs) linear scan to O(32) longest-prefix match, plus a configurable rolling-window dashboard traffic query**

## Accomplishments
- Proposal 1: `lookupCountry()` now walks a CIDR trie built once on load/refresh instead of linearly scanning every country/CIDR per packet, with nested ranges handled by longest-prefix match.
- Proposal 3: Dashboard stats sum traffic over a bounded, configurable rolling window (indexed `timestamp` column), expose `trafficWindowHours`, and replace three `user.count()` queries with one `groupBy`.
- Proposal 2: Confirmed already satisfied — no code change (see Proposals deferred).
- Added unit tests covering CIDR parsing, lookup correctness (match, gaps, nested parent/child ranges, /0, /32, malformed skip, empty index).

## Verification
- `npm run typecheck` — clean.
- `npm run test-only` — 564 pass / 0 fail (includes new geoip index tests).
- `npm run lint` — clean.
- `npm run format:check` — all files conform (edited files reformatted with Prettier).
- Full `npm test` chain passes end-to-end.

## Files Created/Modified
- `src/lib/geoip-manager.ts` — added `cidrToNetworkAndMask`, trie-shaped `GeoIPLookupEntry`, `buildLookupIndex`, `lookupCountryInIndex`; manager keeps a `lookupIndex` rebuilt on parse/refresh; `lookupCountry` uses the index; `matchesCIDR` refactored to share the parser.
- `src/lib/dashboard-stats.ts`, `src/lib/real-time-broadcaster.ts`, `src/app/api/dashboard/stats/route.ts`, `src/types/monitoring.ts`, `src/components/dashboard/metrics-cards.tsx` — shared dashboard stats helper; rolling-window traffic payload fields (`trafficBytesInWindow`, `trafficBytesOutWindow`, `trafficWindowHours`); API and WebSocket update paths share the same semantics; UI labels the metric as `Traffic (<hours>h)`.
- `src/lib/__tests__/geoip-manager.test.ts` — new `cidrToNetworkAndMask` and `buildLookupIndex + lookupCountryInIndex` describe blocks.

## Decisions Made
- Reused the masked-network computation across `matchesCIDR` and the index so both paths agree exactly on membership semantics.
- Used longest-prefix-match for nested/overlapping ranges; most-specific prefix wins, and duplicate prefixes keep deterministic build order.
- Kept `matchesCIDR` exported (still tested, still used) rather than deleting it.

## Task Commits
Git operations (commit/push/PR) are handled by workflow automation per the queue contract; this plan made no direct commits. Implementation is staged in the working tree for the workflow to commit.

## Deviations from Plan
None for Proposals 1 and 3 — executed as specified. Proposal 2 intentionally not re-implemented; rationale below.

## Issues Encountered
None.

## Next Phase Readiness
- GeoIP hot path is now lookup-efficient for the ~200K-CIDR v2fly database.
- Dashboard stats no longer scan unbounded traffic history each tick, and the UI no longer presents the rolling-window metric as all-time total traffic.

## Proposals deferred
- **Proposal 2 (API Route Handler Abstraction):** already implemented and in production use. `src/lib/api-handler.ts` ships an `apiHandler` wrapper (the functional equivalent of the proposed `withHandler`) that centralizes try/catch, maps Prisma `P2002`→409 / `P2025`→404 and generic→500, and uses the existing `api-response.ts` helpers. It is already adopted by 5 API routes (users, servers, and others), exceeding the "≥3 migrated routes" acceptance bar. The same wrapper handles both query (GET) and body (POST) handlers, so a separate `withQueryHandler` is unnecessary. Re-implementing or renaming the existing, verified wrapper would be churn with no behavioral gain, so it was left untouched.
