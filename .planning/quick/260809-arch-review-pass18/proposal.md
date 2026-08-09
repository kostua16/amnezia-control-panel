# Architectural Review Pass 18 (2026-08-09)

Source: `/gsd:explore` eighteenth-pass review (non-duplicative vs proposals #1-#49 and open PRs).

Deduped vs open PRs: #1055 (GSD planning intake), #1033 (stale-issue boundaries), #1020 (auto re-run transient failures), #877 (audit-area rotation) — all workflow/automation, zero source overlap.

## Proposals

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 50 | **DRY: `dashboard-stats.ts` duplicates env var parsing from `env.ts`** | Low-Medium (DRY) | `src/lib/dashboard-stats.ts:4-10`, `src/lib/env.ts:85-91` | Proposed |
| 51 | **Vestigial `/api/routing/apply` endpoint falsely claims rules are applied** | Medium (Correctness) | `src/lib/rule-enforcement.ts:59-80,152-180`, `src/app/api/routing/apply/route.ts` | Proposed |

## Proposal #50: DRY — `dashboard-stats.ts` duplicates env var parsing

**File:** `src/lib/dashboard-stats.ts:4-10`

**Problem:** `TRAFFIC_STATS_WINDOW_HOURS` is parsed via a module-level IIFE that reads `process.env.TRAFFIC_STATS_WINDOW_HOURS` directly, duplicating the logic already centralized in `env.ts:getTrafficStatsWindowHours()` (line 85-91). The env.ts getter is the canonical, typed, and tested version (`src/lib/__tests__/env.test.ts:66-71`). If the default or parsing changes in one location, the other silently diverges — the dashboard stats window would differ from the admin's configured value with no warning.

**Fix:** Replace the inline IIFE with `import { getTrafficStatsWindowHours } from '@/lib/env'` and use the getter for `TRAFFIC_STATS_WINDOW_HOURS` and derived `TRAFFIC_STATS_WINDOW_MS`. Delete the duplicated parsing.

**Benefit:** Single source of truth for the env var; tested getter reused; no silent divergence risk.

---

## Proposal #51: Vestigial `/api/routing/apply` falsely reports applied rules

**Files:**
- `src/lib/rule-enforcement.ts:59-80` (`generateXrayRulesFromDB`)
- `src/lib/rule-enforcement.ts:152-180` (`applyRoutingRules`, `applyAllRules`)
- `src/app/api/routing/apply/route.ts:1-74`

**Problem:** Three related issues make this endpoint misleading:

1. **Broken `nodeId` assignment:** `generateXrayRulesFromDB` (line 69) builds `nodeId` from `rule.userId` (`user-${rule.userId}`) or `rule-${rule.id}`. Neither is a chain node label — the field is supposed to reference a chain node for Xray routing. Any consumer using these rules for real Xray configuration would route to nonexistent nodes.

2. **False `appliedCount`:** `applyRoutingRules`/`applyAllRules` (lines 152-180) return `{ success: true, appliedCount: rules.length, awgConfig: null, threeXuiConfig: null }`. The `appliedCount` field strongly implies rules were pushed to VPN services, but `awgConfig` and `threeXuiConfig` are always `null` — nothing is actually applied. The real rule-application path uses `chain-config-generator.ts` → `panel-sync-client.ts` → `config-applier.ts`.

3. **API route exposes misleading data:** `routing/apply/route.ts` returns `appliedCount` to the frontend, which likely displays "N rules applied" when zero rules were applied.

**Fix:** Either:
- (a) **Remove** the vestigial functions (`applyRoutingRules`, `applyAllRules`) and the API route, since real rule application goes through the chain push path. Add a deprecation notice in the API response if immediate removal is risky.
- (b) **Rename** to `generateRoutingRules` / `generateAllRules`, rename `appliedCount` to `generatedCount`, and set `success` to indicate generation only (not application). Remove `awgConfig`/`threeXuiConfig` from the response shape since they are always null.

**Benefit:** Eliminates misleading API responses; removes dead-end code that produces incorrect Xray rule metadata; reduces maintenance burden on code that looks functional but isn't.
