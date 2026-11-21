# Runbook: roll back the GitHub-hosted runner migration

- **Date:** 2026-11-22
- **Tracking:** #1128 (RUN-M01)
- **Decision record:** [ADR 0003](../adr/0003-github-hosted-runners-for-all-workflows.md)
- **Pre-migration ref:** `7069c6611c0a53f768efce4c9e0832289b7073d7`

This guide lets an operator with no context undo the move from self-hosted runners
(`self-hosted` and `[self-hosted, big]`) to GitHub-hosted `ubuntu-latest`, either
fully or only for the heavy jobs. The inventory (section 3) and the label map
(section 4) are generated from git, not typed by hand.

## 1. When to roll back

Roll back (fully or partially) when one of these is true:

- The repository becomes private, so hosted minutes become billable. Check with
  `gh repo view --json visibility`.
- The hosted minutes quota is exhausted.
- The concurrent-job cap (20 on the Free plan) causes sustained queueing that the
  run monitor's queue-latency telemetry keeps reporting.
- A hosted `No space left on device` failure cannot be fixed by trimming the job's
  footprint (see the `kos-runner-disk-hygiene` skill).

## 2. Reference commits and full rollback

Pre-migration ref: `7069c6611c0a53f768efce4c9e0832289b7073d7` (`origin/main` when
the branch `chore/runners-to-github-hosted` was cut).

The pull request contains ONLY three migration commits:

1. `ci(workflows): run every job on GitHub-hosted ubuntu-latest` (workflows, deleted tooling, tests)
2. `ci(setup-environment): use actions/cache and provision actionlint on hosted runners`
3. `docs(runbooks): add rollback guide for the GitHub-hosted runner migration` (docs, skills, ADR, this runbook)

Find them and the pull request:

```bash
git log --oneline --grep='RUN-M01' main
gh pr list --state merged --search 'RUN-M01'
```

Before either option below, find later edits to the same files. A revert can
conflict on them, and a per-path restore silently discards them, so re-apply them
by hand afterwards:

```bash
git log --oneline 7069c66..main -- <paths>
```

**Option A: revert the whole pull request.** The command depends on how it was merged.

- Merge commit: `git revert -m 1 <merge-sha>`
- Squash merge: `git revert <squash-sha>`
- Rebase merge: `git revert <newest-sha> <middle-sha> <oldest-sha>` (newest first)

With a merge commit or a rebase merge, a single migration commit can also be
reverted on its own, for example only the workflows commit. Because the pull
request holds only the migration, every merge strategy reverts cleanly as a whole.

**Option B: restore per path.** For the inventory paths you want back:

```bash
git checkout 7069c66 -- <path> [<path> ...]
git commit -m "ci: restore <paths> to self-hosted configuration"
```

Added paths (change `A`) have no `7069c66` version; restoring them means
`git rm <path>`.

## 3. Inventory of changed paths

Every path changed between `7069c66` and the migration, generated with
`git diff --name-status 7069c66 -- . ':(exclude).planning'`. Change codes: `M`
modified, `A` added, `D` deleted. The `Commit` column says which migration commit
(1 workflows, 2 setup-environment, 3 docs) touched the path.

| Path                                                                | Change | Commit | How to restore                                                                              | Caveat                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/kos-maintenance.md`                                 | M      | 3      | `git checkout 7069c66 -- .claude/agents/kos-maintenance.md`                                 | Self-hosted disk-hygiene guideline reworded.                                                                                                                                                                                 |
| `.claude/skills/kos-autonomous-audit-fix/SKILL.md`                  | M      | 3      | `git checkout 7069c66 -- .claude/skills/kos-autonomous-audit-fix/SKILL.md`                  | Reference to the deleted action removed.                                                                                                                                                                                     |
| `.claude/skills/kos-daily-maintenance-sweep/SKILL.md`               | M      | 3      | `git checkout 7069c66 -- .claude/skills/kos-daily-maintenance-sweep/SKILL.md`               | Disk bullet reworded.                                                                                                                                                                                                        |
| `.claude/skills/kos-gh-automation-tooling/SKILL.md`                 | M      | 3      | `git checkout 7069c66 -- .claude/skills/kos-gh-automation-tooling/SKILL.md`                 | References to the deleted action removed.                                                                                                                                                                                    |
| `.claude/skills/kos-runner-disk-hygiene/SKILL.md`                   | M      | 3      | `git checkout 7069c66 -- .claude/skills/kos-runner-disk-hygiene/SKILL.md`                   | Rewritten for hosted runners (skill name kept).                                                                                                                                                                              |
| `.claude/skills/kos-zai-run-failure-prevention/SKILL.md`            | M      | 3      | `git checkout 7069c66 -- .claude/skills/kos-zai-run-failure-prevention/SKILL.md`            | Disk-full guidance reworded.                                                                                                                                                                                                 |
| `.github/actionlint.yaml`                                           | M      | 1      | `git checkout 7069c66 -- .github/actionlint.yaml`                                           | Removed the `self-hosted-runner: labels: [big]` block. Needed again if any job is re-labeled `[self-hosted, big]`.                                                                                                           |
| `.github/actions/ensure-disk-space/action.yml`                      | D      | 1      | `git checkout 7069c66 -- .github/actions/ensure-disk-space/action.yml`                      | Deleted composite action; nothing in `.github` consumed it. Restore only if a self-hosted job needs it again.                                                                                                                |
| `.github/actions/setup-environment/action.yml`                      | M      | 2      | `git checkout 7069c66 -- .github/actions/setup-environment/action.yml`                      | Disk step and inputs removed, `maxnowack/local-cache` replaced by `actions/cache`, `install-actionlint` added. Restoring wholesale drops `install-actionlint`; see the key caveat below.                                     |
| `.github/workflows/_auto-fix-ci.yml`                                | M      | 1      | `git checkout 7069c66 -- .github/workflows/_auto-fix-ci.yml`                                | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/antigravity-code-review.yml`                     | M      | 1      | `git checkout 7069c66 -- .github/workflows/antigravity-code-review.yml`                     | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/antigravity.yml`                                 | M      | 1      | `git checkout 7069c66 -- .github/workflows/antigravity.yml`                                 | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/approve-auto-fix.yml`                            | M      | 1      | `git checkout 7069c66 -- .github/workflows/approve-auto-fix.yml`                            | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/audit-auto-prs.yml`                              | M      | 1, 2   | `git checkout 7069c66 -- .github/workflows/audit-auto-prs.yml`                              | runs-on and `install-actionlint: 'true'` added. Drop `install-actionlint` if `setup-environment` is restored wholesale.                                                                                                      |
| `.github/workflows/audit-fix.yml`                                   | M      | 1      | `git checkout 7069c66 -- .github/workflows/audit-fix.yml`                                   | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/auto-cover-review.yml`                           | M      | 1      | `git checkout 7069c66 -- .github/workflows/auto-cover-review.yml`                           | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/ci.yml`                                          | M      | 1, 2   | `git checkout 7069c66 -- .github/workflows/ci.yml`                                          | runs-on plus a reworded `jq` comment (logic unchanged).                                                                                                                                                                      |
| `.github/workflows/claude.yml`                                      | M      | 1      | `git checkout 7069c66 -- .github/workflows/claude.yml`                                      | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/cleanup-runner.yml`                              | D      | 1      | `git checkout 7069c66 -- .github/workflows/cleanup-runner.yml`                              | Deleted runner disk cleanup workflow. Restore together with the monitor self-heal step that dispatched it.                                                                                                                   |
| `.github/workflows/code-review.yml`                                 | M      | 1      | `git checkout 7069c66 -- .github/workflows/code-review.yml`                                 | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/debug-auth-probe.yml`                            | D      | 1      | `git checkout 7069c66 -- .github/workflows/debug-auth-probe.yml`                            | Deleted auth-probing workflow. It restores with `runs-on: self-hosted`, so it needs a registered runner.                                                                                                                     |
| `.github/workflows/deepseek-code-review.yml`                        | M      | 1      | `git checkout 7069c66 -- .github/workflows/deepseek-code-review.yml`                        | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/deepseek.yml`                                    | M      | 1      | `git checkout 7069c66 -- .github/workflows/deepseek.yml`                                    | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/dependency-review.yml`                           | M      | 1, 2   | `git checkout 7069c66 -- .github/workflows/dependency-review.yml`                           | runs-on plus a reworded credentials comment.                                                                                                                                                                                 |
| `.github/workflows/docker-image.yml`                                | M      | 1      | `git checkout 7069c66 -- .github/workflows/docker-image.yml`                                | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/docs-drift.yml`                                  | M      | 1      | `git checkout 7069c66 -- .github/workflows/docs-drift.yml`                                  | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/documentation.md`                                | M      | 3      | `git checkout 7069c66 -- .github/workflows/documentation.md`                                | "Runner-count assumption" replaced by "Runner capacity"; setup-environment notes updated.                                                                                                                                    |
| `.github/workflows/fix-branch.yml`                                  | M      | 1      | `git checkout 7069c66 -- .github/workflows/fix-branch.yml`                                  | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/fix-issue.yml`                                   | M      | 1      | `git checkout 7069c66 -- .github/workflows/fix-issue.yml`                                   | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/fix-pr.yml`                                      | M      | 1      | `git checkout 7069c66 -- .github/workflows/fix-pr.yml`                                      | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/fix-review.yml`                                  | M      | 1      | `git checkout 7069c66 -- .github/workflows/fix-review.yml`                                  | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/gsd-planning-execute.yml`                        | M      | 1      | `git checkout 7069c66 -- .github/workflows/gsd-planning-execute.yml`                        | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/gsd-planning.yml`                                | M      | 1      | `git checkout 7069c66 -- .github/workflows/gsd-planning.yml`                                | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/issue-catch-up.yml`                              | M      | 1      | `git checkout 7069c66 -- .github/workflows/issue-catch-up.yml`                              | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/maintenance.yml`                                 | M      | 1      | `git checkout 7069c66 -- .github/workflows/maintenance.yml`                                 | runs-on, prompt item 7 (runner health self-check) and the "Runner health issues" bullet removed. Restore together with `runner-health-check.cjs`.                                                                            |
| `.github/workflows/merge-pr.yml`                                    | M      | 1      | `git checkout 7069c66 -- .github/workflows/merge-pr.yml`                                    | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/monitor-amnezia-control-panel-github-runs.yml`   | M      | 1, 2   | `git checkout 7069c66 -- .github/workflows/monitor-amnezia-control-panel-github-runs.yml`   | runs-on, the "Self-heal runner disk pressure" step removed, `install-actionlint: 'true'` added. Restore the step together with `cleanup-runner.yml`; drop `install-actionlint` if `setup-environment` is restored wholesale. |
| `.github/workflows/perf-check.yml`                                  | M      | 1      | `git checkout 7069c66 -- .github/workflows/perf-check.yml`                                  | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/planning-intake-repair.yml`                      | M      | 1      | `git checkout 7069c66 -- .github/workflows/planning-intake-repair.yml`                      | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/pr-finalizer.yml`                                | M      | 1      | `git checkout 7069c66 -- .github/workflows/pr-finalizer.yml`                                | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/pr-flow-watchdog.yml`                            | M      | 1      | `git checkout 7069c66 -- .github/workflows/pr-flow-watchdog.yml`                            | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/pr-flow.yml`                                     | M      | 1, 2   | `git checkout 7069c66 -- .github/workflows/pr-flow.yml`                                     | runs-on plus a reworded concurrency comment.                                                                                                                                                                                 |
| `.github/workflows/pr-improve.yml`                                  | M      | 1      | `git checkout 7069c66 -- .github/workflows/pr-improve.yml`                                  | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/pr-policy.yml`                                   | M      | 1      | `git checkout 7069c66 -- .github/workflows/pr-policy.yml`                                   | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/pr-size-guard.yml`                               | M      | 1      | `git checkout 7069c66 -- .github/workflows/pr-size-guard.yml`                               | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/project-manager.yml`                             | M      | 1      | `git checkout 7069c66 -- .github/workflows/project-manager.yml`                             | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/rebase-pr.yml`                                   | M      | 1      | `git checkout 7069c66 -- .github/workflows/rebase-pr.yml`                                   | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/release-notes.yml`                               | M      | 1      | `git checkout 7069c66 -- .github/workflows/release-notes.yml`                               | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/scripts/__tests__/e2e-pr651-flows.test.cjs`      | M      | 1      | `git checkout 7069c66 -- .github/workflows/scripts/__tests__/e2e-pr651-flows.test.cjs`      | The two `P14` self-heal tests and their banner removed. Restore with the monitor self-heal step.                                                                                                                             |
| `.github/workflows/scripts/__tests__/runner-health-check.test.cjs`  | D      | 1      | `git checkout 7069c66 -- .github/workflows/scripts/__tests__/runner-health-check.test.cjs`  | Deleted. Restore together with `runner-health-check.cjs`.                                                                                                                                                                    |
| `.github/workflows/scripts/__tests__/workflow-run-timings.test.cjs` | M      | 1      | `git checkout 7069c66 -- .github/workflows/scripts/__tests__/workflow-run-timings.test.cjs` | Runner-name fixture string only; no restore needed.                                                                                                                                                                          |
| `.github/workflows/scripts/runner-health-check.cjs`                 | D      | 1      | `git checkout 7069c66 -- .github/workflows/scripts/runner-health-check.cjs`                 | Deleted. Restore together with its test and maintenance prompt item 7.                                                                                                                                                       |
| `.github/workflows/security-audit-weekly.yml`                       | M      | 1      | `git checkout 7069c66 -- .github/workflows/security-audit-weekly.yml`                       | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/stale.yml`                                       | M      | 1      | `git checkout 7069c66 -- .github/workflows/stale.yml`                                       | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/suggest-improvements.yml`                        | M      | 1      | `git checkout 7069c66 -- .github/workflows/suggest-improvements.yml`                        | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/supply-chain.yml`                                | M      | 1      | `git checkout 7069c66 -- .github/workflows/supply-chain.yml`                                | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/triage.yml`                                      | M      | 1      | `git checkout 7069c66 -- .github/workflows/triage.yml`                                      | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/workflow-governance.yml`                         | M      | 1      | `git checkout 7069c66 -- .github/workflows/workflow-governance.yml`                         | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.github/workflows/workflow-health-optimize.yml`                    | M      | 1      | `git checkout 7069c66 -- .github/workflows/workflow-health-optimize.yml`                    | `runs-on` lines only (see the label map). Later edits to this file are lost on restore.                                                                                                                                      |
| `.serena/memories/ci/pr-flow-cancel-in-progress-rationale.md`       | M      | 3      | `git checkout 7069c66 -- .serena/memories/ci/pr-flow-cancel-in-progress-rationale.md`       | Runner-count assumption replaced by hosted-runner capacity note.                                                                                                                                                             |
| `docs/TODOs-2.md`                                                   | M      | 3      | `git checkout 7069c66 -- docs/TODOs-2.md`                                                   | Added `M` type, section 8 with RUN-M01 and the superseded list.                                                                                                                                                              |
| `docs/adr/0003-github-hosted-runners-for-all-workflows.md`          | A      | 3      | `git rm docs/adr/0003-github-hosted-runners-for-all-workflows.md`                           | New decision record.                                                                                                                                                                                                         |
| `docs/gh-workflows-architecture-review.md`                          | M      | 3      | `git checkout 7069c66 -- docs/gh-workflows-architecture-review.md`                          | Historical-document banner added at the top.                                                                                                                                                                                 |
| `docs/migrate-to-falcondev-cache-server.md`                         | M      | 3      | `git checkout 7069c66 -- docs/migrate-to-falcondev-cache-server.md`                         | Historical-document banner added at the top.                                                                                                                                                                                 |
| `docs/runbooks/self-hosted-to-hosted-runners-rollback.md`           | A      | 3      | `git rm docs/runbooks/self-hosted-to-hosted-runners-rollback.md`                            | This runbook.                                                                                                                                                                                                                |
| `docs/workflow-e2e-scenarios.md`                                    | M      | 1      | `git checkout 7069c66 -- docs/workflow-e2e-scenarios.md`                                    | The `P14` row was marked retired. Restore with the monitor self-heal step.                                                                                                                                                   |
| `src/lib/__tests__/docker-image-workflow.test.ts`                   | M      | 1      | `git checkout 7069c66 -- src/lib/__tests__/docker-image-workflow.test.ts`                   | Expectations changed to `ubuntu-latest`. Restore if the docker-image jobs move back.                                                                                                                                         |
| `src/lib/__tests__/pr-flow-watchdog.test.ts`                        | M      | 1      | `git checkout 7069c66 -- src/lib/__tests__/pr-flow-watchdog.test.ts`                        | Expectation changed to `ubuntu-latest`. Restore if `classify-trigger` moves back.                                                                                                                                            |
| `src/lib/__tests__/workflow-disk-pruning-policy.test.ts`            | D      | 2      | `git checkout 7069c66 -- src/lib/__tests__/workflow-disk-pruning-policy.test.ts`            | Deleted: it asserted the removed disk-pruning step. Restore with that step.                                                                                                                                                  |
| `src/lib/__tests__/workflow-github-hosted-runners.test.ts`          | A      | 1, 2   | `git rm src/lib/__tests__/workflow-github-hosted-runners.test.ts`                           | New guard test (every `runs-on` is `ubuntu-latest`, pinned `actions/cache`, verified actionlint). Remove or relax it when any job moves back to self-hosted.                                                                 |
| `src/lib/__tests__/workflow-run-timings.test.ts`                    | M      | 1      | `git checkout 7069c66 -- src/lib/__tests__/workflow-run-timings.test.ts`                    | Runner-name fixture string only; no restore needed.                                                                                                                                                                          |
| `src/lib/__tests__/workflow-triggers.test.ts`                       | M      | 1      | `git checkout 7069c66 -- src/lib/__tests__/workflow-triggers.test.ts`                       | Expectation changed to `ubuntu-latest`. Restore if `classify-trigger` moves back.                                                                                                                                            |

Pairs that must be restored together:

- The `cleanup-runner.yml` workflow, the monitor "Self-heal runner disk pressure"
  step, the two `P14` tests in `e2e-pr651-flows.test.cjs`, and the `P14` row in
  `docs/workflow-e2e-scenarios.md`.
- `runner-health-check.cjs`, its test, and maintenance prompt item 7 (plus the
  "Runner health issues" bullet) in `maintenance.yml`.
- The `Ensure minimum disk space` step with its two inputs in `setup-environment`,
  `maxnowack/local-cache`, and `workflow-disk-pruning-policy.test.ts`.

Key caveat for `setup-environment`: restoring it wholesale from `7069c66` drops the
`install-actionlint` input, so also remove `install-actionlint: 'true'` from the
run monitor and `audit-auto-prs.yml` (a leftover input only logs an
"unexpected input" warning, because a self-hosted host provides its own `actionlint`). The recommended alternative is to keep the
current action and re-add only the disk step plus `workflow-disk-pruning-policy.test.ts`.

## 4. Label map

Generated from `git show 7069c66:.github/workflows/<file>`: every job and the
`runs-on` value it had before the migration (`git ls-tree --name-only 7069c66 .github/workflows/`
includes the two deleted workflows).

| Workflow                                        | `[self-hosted, big]` jobs                                        | `self-hosted` jobs                                            | Already `ubuntu-latest` (unchanged)                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `_auto-fix-ci.yml`                              | `fix`                                                            | -                                                             | -                                                                                                                |
| `antigravity-code-review.yml`                   | `antigravity-review`                                             | `authorize`, `wake-orchestrator`                              | -                                                                                                                |
| `antigravity.yml`                               | `antigravity-interaction`                                        | `authorize`                                                   | -                                                                                                                |
| `approve-auto-fix.yml`                          | -                                                                | `authorize`, `approve`                                        | -                                                                                                                |
| `audit-auto-prs.yml`                            | `audit-auto-prs`                                                 | `fleet-gate`, `reconcile`, `report-failure`, `publish-digest` | -                                                                                                                |
| `audit-fix.yml`                                 | `audit-fix`                                                      | `fleet-gate`, `reconcile`, `report-failure`                   | -                                                                                                                |
| `auto-cover-review.yml`                         | -                                                                | `cover`                                                       | -                                                                                                                |
| `auto-pr-branch-cleanup.yml`                    | -                                                                | -                                                             | `restore-deferred-proposal`, `delete-generated-branch`, `cleanup-orphan-branches`                                |
| `ci.yml`                                        | `lint`, `typecheck`, `test`, `build`, `security-audit`           | `changes`, `ci-result`                                        | -                                                                                                                |
| `claude.yml`                                    | `claude`                                                         | `authorize`                                                   | -                                                                                                                |
| `cleanup-runner.yml`                            | -                                                                | `cleanup`                                                     | -                                                                                                                |
| `code-review.yml`                               | `claude-combined-review`                                         | `resolve-pr`, `wake-orchestrator`                             | -                                                                                                                |
| `debug-auth-probe.yml`                          | -                                                                | `probe`                                                       | -                                                                                                                |
| `deepseek-code-review.yml`                      | `deepseek-review`                                                | `resolve-pr`                                                  | -                                                                                                                |
| `deepseek.yml`                                  | `deepseek`                                                       | `authorize`                                                   | -                                                                                                                |
| `dependency-review.yml`                         | `ai-dependency-review`                                           | `resolve-pr`, `wake-orchestrator`                             | -                                                                                                                |
| `docker-image.yml`                              | `docker-build`, `docker-build-stack`, `publish`, `publish-stack` | `classify`                                                    | -                                                                                                                |
| `docs-drift.yml`                                | `docs-drift`                                                     | `fleet-gate`, `report-failure`                                | -                                                                                                                |
| `fix-branch.yml`                                | -                                                                | `evaluate`, `report-failure`                                  | -                                                                                                                |
| `fix-issue.yml`                                 | `fix`                                                            | `authorize`, `report-failure`                                 | -                                                                                                                |
| `fix-pr.yml`                                    | -                                                                | `evaluate`, `report-failure`                                  | -                                                                                                                |
| `fix-review.yml`                                | `fix`                                                            | `authorize`                                                   | -                                                                                                                |
| `gsd-planning-execute.yml`                      | `execute`                                                        | `fleet-gate`, `promote-deferred`, `report-failure`            | -                                                                                                                |
| `gsd-planning.yml`                              | `plan`                                                           | `authorize`                                                   | -                                                                                                                |
| `issue-catch-up.yml`                            | `analyze-and-act`                                                | `collect-issues`, `report-failure`                            | -                                                                                                                |
| `maintenance.yml`                               | `maintenance`                                                    | `report-failure`                                              | -                                                                                                                |
| `merge-pr.yml`                                  | `consolidate`                                                    | -                                                             | -                                                                                                                |
| `monitor-amnezia-control-panel-github-runs.yml` | `monitor-runs`                                                   | `fleet-gate`, `report-failure`                                | -                                                                                                                |
| `perf-check.yml`                                | `bundle-size`                                                    | -                                                             | -                                                                                                                |
| `planning-intake-repair.yml`                    | -                                                                | `authorize`, `repair`                                         | -                                                                                                                |
| `pr-finalizer.yml`                              | -                                                                | `finalize`, `wake-orchestrator`                               | -                                                                                                                |
| `pr-flow-watchdog.yml`                          | -                                                                | `watch`                                                       | -                                                                                                                |
| `pr-flow.yml`                                   | -                                                                | `classify-trigger`, `orchestrate`                             | -                                                                                                                |
| `pr-improve.yml`                                | `improve`                                                        | `collect-targets`, `wake-orchestrator`, `report-failure`      | -                                                                                                                |
| `pr-policy.yml`                                 | -                                                                | `label-and-validate`                                          | -                                                                                                                |
| `pr-size-guard.yml`                             | -                                                                | `size-check`                                                  | -                                                                                                                |
| `project-manager.yml`                           | `manage`                                                         | `report-failure`                                              | -                                                                                                                |
| `rebase-pr.yml`                                 | `rebase`                                                         | `authorize`                                                   | -                                                                                                                |
| `release-notes.yml`                             | -                                                                | `generate-release-notes`                                      | -                                                                                                                |
| `review-approved.yml`                           | -                                                                | -                                                             | `gate`, `record-approval`                                                                                        |
| `security-audit-weekly.yml`                     | `audit`                                                          | -                                                             | -                                                                                                                |
| `stale.yml`                                     | -                                                                | `stale`                                                       | -                                                                                                                |
| `suggest-improvements.yml`                      | `suggest-improvements`                                           | `report-failure`                                              | -                                                                                                                |
| `supply-chain.yml`                              | -                                                                | `validate`                                                    | -                                                                                                                |
| `triage.yml`                                    | `triage`                                                         | -                                                             | -                                                                                                                |
| `workflow-governance.yml`                       | -                                                                | `governance`                                                  | -                                                                                                                |
| `workflow-health-optimize.yml`                  | `optimize`                                                       | -                                                             | `fleet-gate`, `collect-runs`, `detect-flaky`, `report-queue-starvation`, `report-blocked-gate`, `report-failure` |

Total re-labeled jobs: **98**, equal to
`git diff 7069c66 HEAD -- '.github/workflows/*.yml' | grep -cE '^-[[:space:]]+runs-on:'`
(62 `self-hosted` + 36 `[self-hosted, big]`, including the jobs in the two deleted
workflows). Always count `runs-on` with the anchored pattern on `*.yml` only: an
unanchored `grep` over `.github/workflows` also matches a regex literal in
`workflow-governance-check.cjs`.

Reverse relabeling for files whose jobs all shared one label (generated; run from
the repository root):

```bash
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1\[self-hosted, big\]/' .github/workflows/_auto-fix-ci.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/approve-auto-fix.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/auto-cover-review.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/fix-branch.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/fix-pr.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1\[self-hosted, big\]/' .github/workflows/merge-pr.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1\[self-hosted, big\]/' .github/workflows/perf-check.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/planning-intake-repair.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/pr-finalizer.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/pr-flow-watchdog.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/pr-flow.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/pr-policy.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/pr-size-guard.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/release-notes.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1\[self-hosted, big\]/' .github/workflows/security-audit-weekly.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/stale.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/supply-chain.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1\[self-hosted, big\]/' .github/workflows/triage.yml
sed -i -E 's/^([[:space:]]*runs-on:[[:space:]]*)ubuntu-latest/\1self-hosted/' .github/workflows/workflow-governance.yml
# mixed-label files (edit per job, see the table): .github/workflows/antigravity-code-review.yml .github/workflows/antigravity.yml .github/workflows/audit-auto-prs.yml .github/workflows/audit-fix.yml .github/workflows/ci.yml .github/workflows/claude.yml .github/workflows/code-review.yml .github/workflows/deepseek-code-review.yml .github/workflows/deepseek.yml .github/workflows/dependency-review.yml .github/workflows/docker-image.yml .github/workflows/docs-drift.yml .github/workflows/fix-issue.yml .github/workflows/fix-review.yml .github/workflows/gsd-planning-execute.yml .github/workflows/gsd-planning.yml .github/workflows/issue-catch-up.yml .github/workflows/maintenance.yml .github/workflows/monitor-amnezia-control-panel-github-runs.yml .github/workflows/pr-improve.yml .github/workflows/project-manager.yml .github/workflows/rebase-pr.yml .github/workflows/suggest-improvements.yml .github/workflows/workflow-health-optimize.yml
```

Files with mixed labels need per-job edits using the table above. Files edited
after the migration also need per-job edits; do not restore them wholesale.

## 5. Re-register self-hosted runners

Use Linux x64 hosts, at least two (the `pr-flow` fan-out serializes on one).

Required software: bash, git, curl, tar, coreutils (`timeout`, `sha256sum`), Node 24,
Docker engine with buildx (runner user in the `docker` group), `jq`, `shellcheck`,
`python3`, and a writable `~/.local/bin` (`setup-environment` installs `rtk` there).
Keep at least 4 GB free (the `ensure-docker-disk-space` threshold) and plan for at
least 50 GB of disk. The Actions runner must be 2.327.1 or newer, because
`actions/cache` v5+ runs on Node 24.

**Security first.** On a public repository, set Settings, Actions, General,
"Require approval for all outside collaborators" for fork pull request workflows
BEFORE bringing any self-hosted runner online. Otherwise a fork PR can run code on
the host.

Steps, on each host:

```bash
# 1. registration token (valid for one hour)
gh api -X POST repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions/runners/registration-token --jq .token

# 2. download the runner: Settings > Actions > Runners > New self-hosted runner
#    shows the exact version and checksum to use

# 3. configure (add --labels big ONLY on large-pool hosts;
#    self-hosted, Linux and X64 are applied automatically)
./config.sh --url https://github.com/<owner>/<repo> --token <token> --name <host>-N --unattended
# for large-pool hosts:
./config.sh --url https://github.com/<owner>/<repo> --token <token> --name <host>-N --labels big --unattended

# 4. install as a service
sudo ./svc.sh install <user> && sudo ./svc.sh start

# 5. confirm
gh api repos/<owner>/<repo>/actions/runners --jq '.runners[] | {name,status,labels:[.labels[].name]}'
```

## 6. Partial rollback (heavy jobs only)

1. Re-label only the `[self-hosted, big]` column of the label map.
2. Restore the actionlint label block in `.github/actionlint.yaml`:
   `self-hosted-runner:` with `labels:` and `- big` (`git checkout 7069c66 -- .github/actionlint.yaml`).
3. Relax `src/lib/__tests__/workflow-github-hosted-runners.test.ts` test A to an
   explicit allow-list of the re-labeled jobs, and restore the expectations in
   `docker-image-workflow.test.ts`, `pr-flow-watchdog.test.ts` and
   `workflow-triggers.test.ts` if their jobs move.
4. Consider restoring the `setup-environment` disk step (and
   `workflow-disk-pruning-policy.test.ts`) for the self-hosted jobs.

## 7. Post-rollback verification

```bash
actionlint -config-file .github/actionlint.yaml
npm run test-only
cd .github/workflows && node --test scripts/__tests__/*.test.cjs && cd ../..
npm run lint
npx prettier --check <changed .js/.cjs/.ts/.tsx files>
git grep -hE '^[[:space:]]*runs-on:' -- '.github/workflows/*.yml' | sort | uniq -c
```

Compare the last output with the label map. Both test commands are required:
`npm run test-only` alone gives a false green on workflow logic.

Dispatch smoke test: pick one `workflow_dispatch` workflow per label (list them with
`git grep -l workflow_dispatch -- .github/workflows`), then:

```bash
gh workflow run <file>
gh run watch
gh run view <id> --json jobs --jq '.jobs[].runnerName'
```

Confirm each job lands on a self-hosted runner.

## 8. Hosted vs self-hosted behavior differences

- Fresh VM per job versus a persistent workspace and caches.
- `actions/cache`: 10 GB per repository, LRU and 7-day eviction, branch-scoped,
  versus the runner-local `maxnowack/local-cache`.
- About 14 GB of free disk versus the host disk.
- Concurrency cap of 20 (Free plan) versus the runner count.
- 6 hour job limit.
- Free minutes only while the repository is public.
- `actionlint` is provided by `setup-environment` (`install-actionlint`) instead of the host.
- No disk self-heal and no runner health check.
- Logs and the VM are ephemeral: no residue between jobs.
