# Validating pr-flow / GitHub Actions concurrency changes

GitHub Actions concurrency (and `pull_request_target` behavior) CANNOT be validated
locally — `tsc`, lint, tests, actionlint, and prettier all pass regardless of the
concurrency expression. Two reasons:

1. `pull_request_target` and `workflow_run` execute the workflow from the DEFAULT
   branch (`main`), NOT the PR branch. So a concurrency fix is DORMANT until merged
   — you cannot observe it on the PR itself.
2. Concurrency cancellation is runtime infra behavior; no local tool reproduces it.

## Method that works

Open a THROWAWAY PR off `main` (trivial or `--allow-empty` commit so the branch
differs), wait ~2–3 min for the relevant event + the canceller to fire, then inspect
the job conclusion:

```bash
gh api repos/<o>/<r>/actions/runs/<id>/jobs --jq '.jobs[] | select(.name=="orchestrate") | .conclusion'
```

Then close the PR and delete the branch:
`gh api -X PATCH repos/<o>/<r>/pulls/<n> -f state=closed` + `git push origin --delete <branch>`.

## "Merged ≠ verified"

PR #428 passed EVERY local check (governance 0 errors, 67/67 tests, actionlint
clean, prettier clean) AND repo CI — yet a real `pull_request_target` event exposed
that `issue_comment` still cancelled the prt orchestrate. The real fix (#431,
prt/wake isolation) was only provable AFTER merge + a throwaway-PR validation. For
any change to pr-flow.yml concurrency, treat the throwaway-PR check as the actual
gate, not the green CI.

## Diagnosing a cancelled pr-flow run

A cancelled `orchestrate` is almost never a code error (it succeeds whenever it
runs). Find the canceller by timing: list pr-flow runs for the PR with event +
created_at, and see which OTHER run in the SAME concurrency group fired while the
orchestrate was in_progress. See [[ci/pr-flow-concurrency-groups]] and
[[ci/pr-flow-only-prt-runs-are-pr-checks]].