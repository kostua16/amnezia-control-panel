---
status: resolved
trigger: "investigate why code-review for PR#366 was failed and didnt left any comment or evidence"
created: 2026-06-13T00:00:00Z
updated: 2026-06-13T15:00:00Z
---

## Current Focus

hypothesis: A non-review issue comment triggered a second Code Review workflow run and canceled the in-progress orchestrated review before it could publish review evidence.
test: Compare PR #366 comment timestamps, Code Review run timestamps, run conclusions, and `.github/workflows/code-review.yml` trigger/concurrency/filter order.
expecting: The original run should be cancelled, a later issue_comment run should resolve `should_run=false`, and workflow-level concurrency should key both runs to `code-review-366`.
next_action: Propose a workflow fix that prevents non-review issue comments from canceling active reviews.

## Symptoms

expected: The code-review workflow for PR #366 should either pass or leave a PR comment/review artifact explaining the failure.
actual: The code-review check failed but left no visible comment or evidence.
errors: No visible PR comment or evidence was left by the failed code-review run.
reproduction: Trigger or inspect the code-review workflow for PR #366.
started: Observed by user on 2026-06-13.

## Eliminated

## Evidence

- timestamp: 2026-06-13T15:00:00Z
  checked: gh run view 27469912160 --repo kostua16/amnezia-control-panel --json name,event,status,conclusion,createdAt,updatedAt,headSha,headBranch,jobs,url
  found: Code Review run 27469912160 for PR #366 head `5e4b635e30833b3064c04fd6a0ff2bcf5f3fd1b2` concluded `cancelled`; both `claude-main-review` and `claude-security-review` were cancelled during their review steps, and both apply-signal steps were skipped.
  implication: The workflow did not reach the labels/comments/review-signal publishing path, so no review evidence was expected from that run.

- timestamp: 2026-06-13T15:00:00Z
  checked: gh pr view 366 --repo kostua16/amnezia-control-panel --json comments
  found: User comment `/approve` was created at 2026-06-13T14:49:43Z; a second Code Review run 27470004852 was created at 2026-06-13T14:49:46Z from the `issue_comment` event.
  implication: The non-review `/approve` comment was the event that started the replacement Code Review workflow run.

- timestamp: 2026-06-13T15:00:00Z
  checked: gh run view 27470004852 --repo kostua16/amnezia-control-panel --json name,event,createdAt,conclusion,jobs,url
  found: The replacement issue_comment Code Review run succeeded overall, but `claude-main-review`, `claude-security-review`, and `wake-orchestrator` were skipped after `resolve-pr`.
  implication: The replacement run canceled useful work, then intentionally did no review because the comment was not `/review`.

- timestamp: 2026-06-13T15:00:00Z
  checked: .github/workflows/code-review.yml
  found: The workflow triggers on every `issue_comment.created`, uses workflow-level concurrency group `code-review-${{ github.event.issue.number || github.event.inputs.pr_number || github.sha }}` with `cancel-in-progress: true`, and only later filters issue comments by `comment.body.includes('/review')` inside `resolve-pr`.
  implication: GitHub applies concurrency before the job-level `/review` filter can set `should_run=false`; any PR comment can cancel an active Code Review run for that PR.

## Resolution

root_cause: `.github/workflows/code-review.yml` lets all PR issue comments enter the same `code-review-<pr>` concurrency group before checking whether the comment is actually `/review`. The `/approve` comment on PR #366 spawned run 27470004852 and canceled active run 27469912160, then skipped review jobs because `should_run=false`.
fix: Applied a targeted workflow guard so non-review issue comments use a unique `code-review-ignored-<run_id>` concurrency group, while real review requests and orchestrated dispatches still use `code-review-<pr>`.
verification: Confirmed via PR comments, Code Review run details, filtered run logs, local workflow lines for trigger/concurrency/comment filtering, focused workflow trigger test, lint, Prettier, actionlint, and full tests after regenerating Prisma.
files_changed:
  - .github/workflows/code-review.yml
  - src/lib/__tests__/workflow-triggers.test.ts
  - .planning/debug/pr366-code-review-no-evidence.md
