# Quick Task 260815-rt9 — MON-E06 cost telemetry

Task: task-008 (god), Issue #1049 (closes via PR), TODO MON-E06 in docs/TODOs-2.md.

## Goal

Aggregate per-run Claude cost/turn telemetry for monitor workflow runs into a
retained artifact with fleet + per-workflow/model stats, so fleet budgets can
be tuned from complete data (today cost is only visible in failure issues).

## Design

New `.github/workflows/scripts/aggregate-run-costs.cjs`:

- Pure helpers with injected gh runner `(args) => ({ok, stdout, error})`
  (same pattern as `rerun-transient-failed-runs.cjs`).
- `fetchCompletedRuns` — `gh api repos/{repo}/actions/workflows/{file}/runs`
  with `status=completed`, `--paginate`, streaming jq (NDJSON parsed by
  `parseGhJsonLines` reused from `fleet-kpi-digest.cjs`); filters window,
  excludes current run id, caps at `--max-runs`.
- `fetchRunJobs` — jobs per run with `run_attempt`.
- `capLogText` — keep tail bytes (`--max-log-bytes`, default 512KB) so the
  SDK result metrics near the end survive.
- `buildRecord` — `parseClaudeExecution({logText})` from
  `parse-claude-execution.cjs`; jobs with no turns AND no cost count as
  `missing` (e.g. fleet-gate); normalized versioned record
  (`schema_version: 1`, run/job/attempt key, workflow, model, timestamps,
  turns, cost_usd, cost_per_turn, duration_sec, outcome, source).
- `dedupeRecords` — key `run_id:job_id:attempt`, last wins, stable sort.
- `aggregate` — fleet + by_workflow + by_model totals/avg/max, sample and
  missing counts, fetch_errors surfaced (stderr + summary).
- CLI: `--repo --workflow-file --since/--window-hours --exclude-run-id
  --max-runs --max-log-bytes --records-file --summary-file --github-output`.
  Exit 1 only when the run listing fails outright (nothing processed);
  partial failures stay visible in summary `fetch_errors`.

Workflow `monitor-amnezia-control-panel-github-runs.yml`: new parallel job
`cost-telemetry` (needs fleet-gate, own 10-min timeout — no pressure on the
agent job's 25-min budget) that runs the script and uploads
`monitor-cost-telemetry-${{ github.run_id }}` artifact (retention 90d,
`if-no-files-found: error`), summary appended to `$GITHUB_STEP_SUMMARY`.

Tests `__tests__/aggregate-run-costs.test.cjs`: valid/missing/malformed logs,
NDJSON/pagination, caps, dedupe, zero values, aggregate math, stable output,
CLI arg/output helpers, workflow + artifact contract assertions.

Docs: `docs/workflow-e2e-scenarios.md` MON-E06 rows.

## Out of scope

- Persistent cross-run merge of JSONL (pairs with WHO-E01 metrics store).
- Other workflows' runs (script is generic in `--workflow-file`, but monitor
  is the wired consumer).
