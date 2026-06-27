---
name: kos-commit-and-push-branch
description: Commit and push changes to the correct PR/automation branch with the bot git identity, avoiding the git_push_403 and "Commit and push" step failures seen in fix-review/code-review runs.
user-invocable: true
when_to_use: "When a workflow task must persist edits to a PR branch or automation branch, or when a run failed at the 'Commit and push' step."
category: utilities
argument-hint: "[pr-number or branch]"
keywords: [commit, push, branch, git-push, 403, bot-identity, automation-pr]
related: [kos-zai-run-failure-prevention, kos-gh-automation-tooling, kos-runner-disk-hygiene]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from fix-review commit-and-push failures + commit-and-push/prepare-automation-branch actions
  license: repo
  version: "1.0"
---

# Idea

Several workflows (fix-review, code-review, fix-issue, audit-fix, pr-improve variants) end with a "Commit and push to the PR branch" step. This is a frequent failure point: it dies with HTTP 403 (`git_push_403`), a non-fast-forward rejection, or an empty-diff abort. The repo has dedicated actions for this (`commit-and-push`, `prepare-automation-branch`, `setup-bot-git`) plus a duplicate-PR guard. The skill is using them correctly instead of raw `git push`.

## When to invoke this skill directly

- Your workflow task produced file edits that must land on a PR/automation branch.
- A run failed at the commit-and-push step (403, rejected, or "nothing to commit").
- You are wiring up a new automation-PR workflow.

## References

- `.github/actions/setup-bot-git/` — sets the bot author/committer identity (must run before commit).
- `.github/actions/prepare-automation-branch/` — creates/switches the automation branch off the right base.
- `.github/actions/commit-and-push/` — staged commit + push with the right token/remote.
- `.github/actions/upsert-pull-request/` + `find-duplicate-automation-pr.cjs` — open or reuse the PR (avoid `graphql_pr_fail` / duplicates).
- `scan-claude-logs.cjs` → `git_push_403`, `graphql_pr_fail`.

## Communication Style

Name the exact step that failed and the one cause (token/identity/non-fast-forward/empty), then the one action to use.

## Core Principles

YAGNI / KISS / DRY. Use the existing `commit-and-push` action; do not reimplement push. Push to a branch you own, never force to `main`.

## Failure causes → fix

| Symptom | Cause | Fix |
|---|---|---|
| `fatal: unable to access … 403` | Push token lacks `contents: write` / wrong remote | Use `GH_PAT` (not `GITHUB_TOKEN`) where write is needed; push via setup-bot-git remote |
| `Commit and push … failure` (generic) | No bot identity, or staged nothing | Run `setup-bot-git` first; only commit when there is a real diff |
| `! [rejected] non-fast-forward` | Branch moved under you | Rebase onto latest base (`rebase-pr` flow) or re-prepare automation branch |
| `pull request create failed: GraphQL:` | Duplicate PR / transient | Use `find-duplicate-automation-pr.cjs` + `upsert-pull-request` |
| Push of an empty tree | Agent made no net change | Skip push; report "no changes" instead of failing the step |

## Your Approach

1. Confirm there is a real `git diff` before committing (empty diff → skip, don't fail).
2. Ensure `setup-bot-git` ran (identity) and the right token is in the remote.
3. Push to the PR/automation branch only; never rewrite `main`.
4. Open/reuse the PR via the upsert+dedupe actions.

## Process Flow (Authoritative)

1. `git status --porcelain` → if empty, exit 0 with "no changes".
2. Stage only the files the task changed.
3. Commit via the bot identity with a conventional message (no AI references).
4. Push to the owned branch using `GH_PAT`.
5. Upsert the PR (dedupe against existing automation PRs).

## Output Format

```
PUSH <branch>  FILES=<n>  TOKEN=<GH_PAT|GITHUB_TOKEN>  PR=<number|reused|none>
```

## Critical Constraints

- Never force-push to `main`/protected branches.
- Do not commit secrets, lockfile noise, or stray worktree artifacts.
- An empty diff is a success-with-no-changes, not a step failure — guard the step with `if: git diff`.
