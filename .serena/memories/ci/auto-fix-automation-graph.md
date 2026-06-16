# Auto-fix / triage / catch-up automation graph

The issue→fix pipeline is **label-driven** and spans several workflows. Misreading the triggers is the usual root of "why wasn't this auto-fixed?" / repeated "Manual fix triage needed" noise.

## Flow
- `triage.yml`: runs on `issues: [opened]` (also `/triage` comment, `workflow_dispatch`). Claude (haiku, via `run-zai`) classifies and labels `triaged` + one priority + `backlog` (for `fixAvailable:false` deps). Issues created with `GITHUB_TOKEN` do NOT fire `issues:opened`, so `report-failure` explicitly re-dispatches triage via `workflow_dispatch`.
- `fix-issue.yml`: triggers ONLY on the `auto-fix-approved` label (or `/fix` comment). Triage does NOT add it — a human/approval flow must. Runs Claude to produce a fix PR.
- `issue-catch-up.yml`: hourly (cron `:37`). Buckets open issues, e.g. `triaged_no_fix` (triaged, no linked PR, <2 fix attempts) → posts ONE "Manual fix triage needed" + `needs-review`. Dead-letter buckets (`triage_dead_letter`, `fix_dead_letter`) fire at ≥2 attempts. Each action bucket skips issues already `needs-review`, so the notice is one-time, not hourly.
- Autonomous audit — `audit-fix.yml` (2×/day) + `audit-auto-prs.yml` (every 3h): run `npm audit`, fix vulns, open PRs **independent of any issue**. A manually-created security tracker does NOT drive the fix; the vuln is fixed by these schedules regardless. A `reconcile` job (on success) marks `dependencies`-labeled trackers `fixed` once every GHSA/CVE id in their body is absent from `npm audit --json` (evidence-based; no body ids → left untouched, no auto-close).
- `scan-claude-logs.cjs`: classifies each Claude run's failure; ANY error-severity finding is FATAL (`run-claude-params`/`gsd-planning-execute` Rule 7 gates commit+PR on `has_error_findings`). Benign noise is filtered: `fatal: no submodule mapping` (self-hosted-runner worktree artifact) and TAP `#`-prefixed test output.

## Labels that drive automation
- `triaged` = triage ran. `auto-fix-approved` = triggers `fix-issue`. `needs-review` = catch-up one-time guard + dead-letter marker.
- Catch-up EXEMPT (never nagged): `keep-open`, `backlog`, `in-progress`, `fixed` — use these to park an issue.
- `high` / `critical` = priority-escalation bucket keys. Priority + `backlog` labels live in `policy.json` `labels` and are created by the `ensure-workflow-labels` action.

## Gotcha: edit-issue-labels.sh silently drops unknown labels
`edit-issue-labels.sh` filters `--add-label` args against `gh label list` — a label that doesn't exist is a **silent no-op** (no error, exit 0). So a workflow prompt saying "add `high`" does nothing if `high` isn't a repo label. Symptom: triage reports a priority in its summary comment but the label never lands. New labels must be added to `policy.json` `labels` (so `ensure-workflow-labels` creates them) before any prompt can apply them.

Validate workflow/action behavior statically: see `mem:ci/testing-and-validation`. Review-stack routing (run-zai → run-claude-params): see `mem:ci/claude-review-stack`.
