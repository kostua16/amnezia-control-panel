---
name: kos-rebase-conflict-resolution
description: Continue an in-progress git rebase of a PR onto its base branch that stopped on conflicts — resolve trivial conflicts automatically, escalate real ones, and survive the post-ancestry comment step that has failed rebase-pr runs.
user-invocable: true
when_to_use: "When the rebase-pr workflow resumes a stopped rebase, or when a rebase-pr run failed in the post-ancestry / upsert-rebase-comment step."
category: utilities
argument-hint: "[pr-number]"
keywords: [rebase, conflict, merge-conflict, ancestry, upsert-comment, rebase-pr]
related: [kos-commit-and-push-branch, kos-gh-automation-tooling, kos-zai-run-failure-prevention]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from rebase-pr.yml prompt + upsert-rebase-comment post-ancestry failures
  license: repo
  version: "1.0"
---

# Idea

`rebase-pr` resumes a rebase that stopped on conflicts. The agent must resolve conflicts and finish, then a post-step (`upsert-rebase-comment.cjs`) reports outcome. Observed failure: that post-step exits 1 with **empty ancestry env** (`MERGE_BASE`, `VISIBLE_COMMIT_COUNT`, `REASON` all blank) — meaning the ancestry analysis produced nothing and the comment step choked on it. The skill is: resolve correctly **and** make the ancestry/comment step robust to empty results.

## When to invoke this skill directly

- You are continuing a stopped rebase for a PR.
- A rebase-pr run failed in the "Post ancestry failure" / upsert-rebase-comment step.

## References

- `rebase-pr.yml` prompt (continue rebase for PR # onto base, stopped on conflicts).
- `.github/workflows/scripts/analyze-rebase-ancestry.cjs` — computes ancestry env.
- `.github/workflows/scripts/auto-resolve-trivial-rebase-conflicts.cjs` — resolves trivial conflicts.
- `.github/workflows/scripts/evaluate-rebase-eligibility.cjs` — whether rebase should run.
- `.github/workflows/scripts/upsert-rebase-comment.cjs` — posts outcome comment (the failure point).

## Communication Style

State conflict count → how many auto-resolved vs. escalated → rebase continued/aborted. Cite the conflict files.

## Core Principles

YAGNI / KISS / DRY. Auto-resolve only trivial conflicts (whitespace, moved blocks); escalate semantic ones. Never force-push past a real conflict. The comment step must handle empty ancestry gracefully.

## Your Approach

1. Confirm rebase is in progress (`git status` shows conflict / `.git/rebase-merge`).
2. Enumerate conflicted files (`git diff --name-only --diff-filter=U`).
3. Run the trivial-conflict resolver; for the rest, attempt semantic resolution per file.
4. If unresolvable: `git rebase --abort`, post a "needs human" comment, exit cleanly (not error).
5. Continue: `git rebase --continue`; force-push **only** the PR branch (`--force-with-lease`).

## Failure modes to avoid

- **Post-ancestry / upsert-comment exit 1 on empty env** → the comment step must tolerate blank `MERGE_BASE`/`REASON`; guard env reads, post a neutral comment, exit 0. Do not let a reporting step fail the whole run.
- **Force-push to wrong branch** → only the PR branch, with `--force-with-lease`.
- **Resolving a semantic conflict as "trivial"** → data loss; escalate instead.
- **Leaving rebase half-done** → either continue to completion or abort cleanly.

## Process Flow (Authoritative)

1. Detect in-progress rebase + conflicted files.
2. auto-resolve-trivial; manually resolve the rest if safe.
3. Unresolvable → abort + human comment + exit 0.
4. Resolvable → `git rebase --continue`, force-with-lease to PR branch.
5. ancestry/comment step must no-op cleanly on empty ancestry (exit 0).

## Output Format

```
REBASE PR #<n> onto <base>: conflicts=<n> auto=<a> manual=<m> => CONTINUED|ABORTED
ANCESTRY: merge_base=<sha|none> visible=<c|0>
```

## Critical Constraints

- Never `--force` to `main` or a shared branch; only the PR branch with `--force-with-lease`.
- Never fail the run from a reporting/comment step on empty data — guard it.
- A semantic conflict is escalated, never auto-resolved.
