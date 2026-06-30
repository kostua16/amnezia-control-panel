---
plan: 999-044
phase: 999
status: complete
---

# Summary: Plan 999-044

## What Changed

Implemented 4 of 5 Quick Wins from the PR #181 workflow improvement intake source artifact. Changes are scoped to `upsert-planning-pr.cjs` (the script), its test file, the scripts directory README, and the maintenance workflow prompt.

### Files Modified

- `.github/workflows/scripts/upsert-planning-pr.cjs` — Enhanced `escapeInline` to sanitize backticks, HTML comments, and markdown links. Added `validateQuickTask` and `validatePhaseSuggestion` functions that check required fields (title, rationale, bucket/phase). Applied validation in `main()` to filter malformed entries with `console.warn`. Exported new functions plus `upsertSingleLineEntry`.
- `src/lib/__tests__/upsert-planning-pr.test.ts` — Added 26 new test cases covering: `escapeInline` (6 cases), `upsertSingleLineEntry` (4 cases), `ensureRoadmapIntakeMarkers` (3 cases), `collectTrackedPaths` (1 case), `summarizePhaseSuggestions` (3 cases), `normalizePhaseSuggestion` (3 cases), `normalizeBucketKey` (4 cases), `validateQuickTask` (3 cases), `validatePhaseSuggestion` (4 cases), `renderQuickPlan` full structure (4 cases), `renderQuickSummary` (1 case).
- `.github/workflows/scripts/README.md` — New file documenting the `createRequire` cross-directory test convention and how to add new tests for workflow scripts.
- `.github/workflows/maintenance.yml` — Added step 6 to the maintenance prompt: prune stale resolved debug docs older than 30 days.

## Self-Check: PASSED

- npm test: 155 suites, 684 pass, 0 fail
- Prettier: clean
- Lint: 0 errors (4 pre-existing warnings)
- Workflow e2e: 364 pass, 0 fail

## Proposals deferred

- **Quick Win 5 (Add stale debug doc cleanup to maintenance workflow):** Implemented as a Claude agent prompt instruction in maintenance.yml rather than a standalone script or cron job. The maintenance workflow already delegates to a Claude agent that can execute file system operations — adding a new workflow job or shell script would be over-engineered for this use case.
- **pr181.1 (Formalize stdout-isolation trust gate):** Phase-level scope — requires auditing evaluate-pr-policy.cjs and resolve-pr-context.cjs for stdout isolation patterns, then codifying a trust gate. Not a quick win.
- **pr181.2 (Pin action refs to SHA and add test gate to ci.yml):** Phase-level scope — requires updating action refs across workflows and adding actionlint + targeted test runs to ci.yml.
- **pr181.3 (Add planning-draft-reviewed label and stale planning PR auto-close):** Phase-level scope — requires label schema changes, PR lifecycle management, and stale-PR timer logic.
- **pr181.4 (Add structured metadata and rollback for phase plan injection):** Phase-level scope — requires metadata sidecar format, rollback CLI flag, and audit trail design.
