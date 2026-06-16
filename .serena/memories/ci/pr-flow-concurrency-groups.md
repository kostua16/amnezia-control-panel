# pr-flow.yml concurrency groups (event-class split)

`pr-flow.yml` keys its concurrency group per PR but SPLITS IT BY EVENT CLASS
(commit fix/pr-flow-orchestrate-cancellation, PR #428):

- `pull_request_target` / `issue_comment` / `workflow_dispatch`  →  `pr-flow-live-<PR#>`
- `workflow_run` wakes (CI, PR Policy, Code Review, Dependency Review, PR Improve,
  PR Finalizer completed)  →  `pr-flow-wr-<PR#>`

Expression: `group: pr-flow-${{ (github.event_name == 'workflow_run' && 'wr') || 'live' }}-<PR#>`.

`cancel-in-progress` is unchanged: TRUE for everything except `pull_request_target`
`labeled`/`unlabeled`. So each class still collapses its own stale reruns, but the
two classes never cancel each other.

WHY: previously all triggers shared one group, so a fast completing check (PR Policy
~1.5–3 min) cancelled the in-flight `pull_request_target` `orchestrate` job before it
ran a step → the "PR Orchestrator" check showed as `cancelled`. See
[[ci/pr-flow-only-prt-runs-are-pr-checks]] for why that was visible. The split removes it.

WHY cancel-in-progress exists at all (the runner constraint): see
[[ci/pr-flow-cancel-in-progress-rationale]].