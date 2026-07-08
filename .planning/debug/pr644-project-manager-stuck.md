---
status: resolved
trigger: "PR #644 did not get pushed/merged to main by project-manager"
created: 2026-07-08T08:28:11Z
updated: 2026-07-08T08:33:16Z
---

# Debug Session: PR #644 Project Manager Stuck

## Symptoms

- expected_behavior: Planning-only PR #644 should progress through PR Flow after required workflow runs complete, then become eligible for finalizer/project-manager handling.
- actual_behavior: PR #644 stayed open on head `f8863a3e6956792a7e1cc80a9477895d0ade2ca6` with `flow/checks-pending`; PR Flow did not dispatch review/finalizer.
- errors: PR Orchestrator run `28917739489` reported `checkStatus.status = pending` with `Lint`, `Type Check`, `Test`, and `Build` pending.
- timeline: The stuck state appeared after `/fix-review` pushed `f8863a3` at 2026-07-08T04:13Z and the required workflows completed by 2026-07-08T04:34Z.
- reproduction: Run PR Flow on a planning-only PR where CI completes successfully with required code jobs skipped by path filtering.

## Current Focus

- hypothesis: PR Flow trusts `gh pr checks` rows that can remain pending for skipped CI jobs instead of reconciling them with completed workflow-run jobs, so planning-only PRs stay in `flow/checks-pending`.
- test: Add a regression where PR checks contain pending CI job rows but workflow-run fallback has completed skipped jobs with no failed siblings.
- expecting: Required-check evidence should map completed workflow-run jobs and return passed.
- next_action: Patch `required-check-evidence.cjs` to fallback when required PR-check rows are pending and exact completed workflow runs are available.

## Evidence

- timestamp: 2026-07-08T08:28:11Z
  source: gh pr view 644
  observation: PR #644 is open, mergeable, head `f8863a3`, labeled `flow/checks-pending`.
- timestamp: 2026-07-08T08:28:11Z
  source: gh run list --branch claude-workflow-optimize-28915684923
  observation: CI, PR Size Guard, Docker Image, PR Policy, and latest PR Orchestrator runs for `f8863a3` all completed successfully.
- timestamp: 2026-07-08T08:28:11Z
  source: gh run view 28916971874
  observation: CI job `Detect changes` succeeded and code jobs `Lint`, `Type Check`, `Test`, `Build`, `Security Audit` were skipped.
- timestamp: 2026-07-08T08:28:11Z
  source: gh run view 28917739489 --log
  observation: PR Flow wrote `flow/checks-pending` because it considered `Lint`, `Type Check`, `Test`, and `Build` pending from `pr-checks`.
- timestamp: 2026-07-08T08:33:16Z
  source: patched orchestrate-pr-flow dry-run against PR #644 workflow_run event
  observation: Required checks resolved as `passed` from `workflow-run-jobs`; PR Flow would remove `flow/checks-pending` and dispatch code review.

## Eliminated

- hypothesis: The PR is unmergeable.
  reason: `gh pr view 644` reports `mergeable: MERGEABLE`.
- hypothesis: CI actually failed.
  reason: The exact-head CI run `28916971874` concluded success.
- hypothesis: Project-manager directly failed to merge a ready PR.
  reason: PR Flow never reached ready/finalizer dispatch; project-manager had no ready surface to act on.

## Resolution

- root_cause: PR Flow trusted stale pending `gh pr checks` rows after a completed required `workflow_run`. For planning-only PR #644, CI intentionally skipped code jobs, but the completed workflow-run job data was the authoritative non-blocking signal.
- fix: `required-check-evidence.cjs` now falls back to completed workflow-run job evidence when a required workflow-run wake sees pending PR-check rows.
- verification: Added regression coverage for stale pending PR-check rows reconciled by completed skipped CI jobs and verified the patched dry-run against live PR #644.
- files_changed:
  - `.github/workflows/scripts/required-check-evidence.cjs`
  - `.github/workflows/scripts/__tests__/required-check-evidence.test.cjs`
  - `docs/workflow-e2e-scenarios.md`
