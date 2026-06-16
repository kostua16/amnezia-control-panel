# Only pull_request_target runs show as PR checks

Key fact for diagnosing pr-flow check states:

- `pull_request_target`-triggered pr-flow runs ATTACH a check to the PR head SHA →
  they appear as the "PR Orchestrator" check on the PR.
- `workflow_run`-triggered pr-flow runs execute on the DEFAULT BRANCH and do NOT
  attach a check to the PR head → they are invisible on the PR checks UI (only in
  the Actions run history).

Consequence: a CANCELLED `pull_request_target` orchestrate is the visible red mark,
even though the actual orchestration work (posting `pr-flow/ready`, dispatching
workers) is done by a later `workflow_run` run. So a cancelled prt check was
cosmetic — PRs stayed mergeable. Dispatch-only workers (code-review, etc.) are
dispatched via workflow_dispatch and also don't naturally appear as head-SHA
checks; pr-flow bridges that by writing commit statuses directly (see documentation.md
"PR Flow Visibility").

This is why the fix in [[ci/pr-flow-concurrency-groups]] targets the prt run
specifically (stop workflow_run from cancelling it).