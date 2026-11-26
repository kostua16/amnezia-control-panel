---
status: complete
quick_id: 260815-rt9
date: 2026-08-15
---

# Quick Task 260815-rt9 Summary

MON-E06 per-run cost/turn telemetry aggregation (task-008, issue #1049).

## Changes

- `.github/workflows/scripts/aggregate-run-costs.cjs` (new): pure helpers
  with injected gh runner — bounded-window completed-run query (`--method
  GET` so `-f` fields stay query params; POST answers 404 on these GET-only
  endpoints), per-run jobs query, tail-capped job logs (SDK metrics live at
  the end), `parseClaudeExecution` reuse, versioned records deduped by
  run/job/attempt, fleet + per-workflow/model aggregates with sample and
  missing counts; 404 (purged/skipped job log) = missing, non-404 =
  surfaced fetch error; runs-list failure exits 1.
- `monitor-amnezia-control-panel-github-runs.yml`: new parallel
  `cost-telemetry` job (needs fleet-gate only, 10-min timeout — keeps log
  fetching off the agent job's 25-minute budget) with
  `--exclude-run-id ${{ github.run_id }}`, step-summary block, and
  `monitor-cost-telemetry-<run_id>` artifact upload (90-day retention).
- `__tests__/aggregate-run-costs.test.cjs` (new): 26 table-driven tests.
- `docs/workflow-e2e-scenarios.md`: MON-E06a/b/c rows.

## Verification

- New suite 26/26 green.
- Live smoke against kostua16/amnezia-control-panel: 90-run window
  produced a real record (run 31410932696 — glm-5-turbo, 20 turns,
  $1.3279, $0.0664/turn, 85.6s), 14 purged/skipped logs counted as
  missing, zero fetch errors; runner-outage-cancelled runs correctly
  contribute no records.
- Full gates: workflow e2e and `npm run test-only` at documented
  baselines; lint 0; targeted prettier clean (see PR).
