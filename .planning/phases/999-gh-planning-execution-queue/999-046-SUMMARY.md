---
plan: 999-046
status: complete
source_artifact: ".planning/quick/260603-pr185-workflow-improve/260603-pr185-PLAN.md"
source_pr: "185"
---

# Summary: Plan 999-046

## Objective
Execute merged planning artifact from PR #185 analysis — implement targeted workflow optimizations.

## What Was Done

### Quick Win 2: Reduce MAX_TURNS in workflow-health-optimize.yml (implemented)
- Reduced `MAX_TURNS` from 40 to 25 with comment documenting the empirical basis
- The optimize job is bounded to max 3 file edits and minimal diffs (5-10 lines); 25 turns is sufficient
- Mirrors the triage.yml reduction pattern (40 → 15) from PR #185
- Commit: `214fe89`

### Quick Win 3: Document null-PR guard pattern (implemented)
- Added `_workflowPatterns.nullPrGuard` to `policy.json` documenting the pattern
- Reference for future workflow authors using `workflow_run` triggers
- Commit: `0aa2767`

## Self-Check
- [x] All tasks executed
- [x] Each task committed individually
- [x] SUMMARY.md created
- [x] Tests pass (648 main + 364 e2e = 1012 total, 0 failures)
- [x] Prettier clean
- [x] No modifications to shared orchestrator artifacts

## Key Files Modified
- `.github/workflows/workflow-health-optimize.yml` — MAX_TURNS reduction
- `.github/workflows/policy.json` — null-PR guard pattern documentation

## Proposals deferred

- **Quick Win 1 (Add early-exit no-op guard to workflow-health-optimize.yml):** Not implementable as described. The `collect-runs` job already early-returns from its script when no runs are found (lines 85-91). A GitHub Actions `if:` guard at the job level cannot check API results before the job runs — the API call itself is what determines whether there are runs. The runner setup cost is inherent to the scheduled trigger.

- **Quick Win 4 (Validate pr-finalizer concurrency group):** This is a validation/audit task, not a code change. The concurrency key correctly falls back to `github.run_id` when `github.event.inputs.pr_number` is empty. No code modification needed; this is a one-time manual confirmation.

- **pr185.1 (Centralize workflow_run null-PR guard as reusable gate):** Phase-level scope — requires creating a shared composite action or policy check script. Beyond quick-task scope; suitable for a dedicated phase.

- **pr185.2 (Pin MAX_TURNS per workflow based on empirical turn usage):** Phase-level scope — requires collecting actual turn usage metrics from completed runs across all workflows, then systematically tuning each one. This plan only addressed the single workflow-health-optimize case.

- **pr185.3 (Add finalizer decision logging for governance):** Phase-level scope — requires adding structured log entries and a queryable storage mechanism for approval pattern auditing.

- **pr185.4 (Auto-generate planning PR follow-ups from optimize findings):** Phase-level scope — requires extending the hourly workflow-health-optimize to invoke the upsert-planning-pr.cjs script when architectural issues are detected.
