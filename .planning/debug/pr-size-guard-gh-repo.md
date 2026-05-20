---
status: investigating
trigger: "Read-only diagnosis only. Do not edit files. Investigate GitHub run #26126423105 for PR #54 in repo /Users/kostua16/.codex/worktrees/f753/amnezia-control-panel. Known symptom: pr-size-guard or size-check failed with 'fatal: not a git repository' while using gh commands. Inspect local workflow files, especially .github/workflows/pr-size-guard.yml, verify exact root cause, and return: 1) precise root cause, 2) minimal safe fix, 3) whether checkout or explicit repo targeting is the better repair in this repo. Keep it concise and decision-oriented."
created: 2026-05-19T21:36:52Z
updated: 2026-05-19T21:40:34Z
---

## Current Focus

hypothesis: The failing workflow invokes raw `gh pr` commands without a checked-out repository and without explicit repo scoping, so `gh` falls back to git-based repo detection and fails.
test: Confirm that knowledge base has no prior matching case, then fetch run #26126423105 logs with explicit repo targeting and network access to verify the exact failing line.
expecting: If true, there will be no knowledge-base match, and the run log will show `fatal: not a git repository` emitted by `gh pr comment` or `gh pr edit` in the lone `size-check` step.
next_action: Retry `gh run view 26126423105 --repo kostua16/amnezia-control-panel --log` with escalated network access.

## Symptoms

expected: PR size guard should compute PR metadata and pass or fail based on size thresholds without environment/setup errors.
actual: `pr-size-guard` / `size-check` failed with `fatal: not a git repository` while using `gh` commands.
errors: fatal: not a git repository
reproduction: Run the `pr-size-guard` workflow for PR #54 without a valid git worktree available to the step that executes `gh` commands.
started: Observed in GitHub Actions run #26126423105 for PR #54.

## Eliminated

## Evidence

- timestamp: 2026-05-19T21:39:18Z
  checked: .github/workflows/pr-size-guard.yml
  found: The workflow has a single shell step with raw `gh pr comment` and `gh pr edit` calls, and it does not use `actions/checkout`.
  implication: The job provides no local git repository for `gh` to infer repo context from.

- timestamp: 2026-05-19T21:39:18Z
  checked: .github/workflows/perf-check.yml
  found: Another workflow in the same repo uses raw `gh pr comment`, but only after `actions/checkout@v5`.
  implication: In this repo, raw `gh pr` usage currently depends on checkout to establish repo context.

- timestamp: 2026-05-19T21:39:18Z
  checked: .github/workflows/scripts/gh.sh
  found: The repo already includes a wrapper that exports `GH_REPO` / uses `--repo` explicitly to scope gh commands to `owner/repo`.
  implication: The repo has an established safer pattern that avoids implicit git-based repo detection.

- timestamp: 2026-05-19T21:40:34Z
  checked: .planning/debug/knowledge-base.md
  found: No knowledge base file exists in `.planning/debug`.
  implication: There is no prior resolved local pattern to reuse for this failure.

- timestamp: 2026-05-19T21:40:34Z
  checked: gh run view 26126423105 --repo kostua16/amnezia-control-panel --log
  found: The command failed in the sandbox with `error connecting to api.github.com`.
  implication: Live run log confirmation requires network access outside the sandbox; the current hypothesis remains based on local workflow evidence.

## Resolution

root_cause:
fix:
verification:
files_changed: []
