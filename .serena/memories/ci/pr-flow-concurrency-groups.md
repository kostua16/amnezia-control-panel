# pr-flow.yml concurrency groups (prt vs wake)

`pr-flow.yml` keys its concurrency group per PR but ISOLATES pull_request_target
runs from every reactive wake, so nothing but a newer PR state change can cancel
the prt `orchestrate` job:

- `pull_request_target` (opened/synchronize/reopened/ready_for_review/converted_to_draft/labeled/unlabeled)
  →  `pr-flow-prt-<PR#>`
- reactive wakes: `workflow_run` (CI, PR Policy, Code Review, Dependency Review,
  PR Improve, PR Finalizer completed), `issue_comment` (`/approve`),
  `workflow_dispatch`  →  `pr-flow-wake-<PR#>`

Expression: `group: pr-flow-${{ (github.event_name == 'pull_request_target' && 'prt') || 'wake' }}-<PR#>`.

`cancel-in-progress` is TRUE for everything except `pull_request_target`
`labeled`/`unlabeled`. Net effect: prt state-change runs cancel older prt runs;
wakes collapse among themselves; a wake can NEVER cancel a prt run.

WHY isolate prt fully (history): a first attempt split only workflow_run into
`pr-flow-wr` vs `pr-flow-live` (PR #428), but `issue_comment` still shared the
`live` group and kept cancelling the prt orchestrate — a bot comment posted ~60s
after PR open cancelled the in-flight prt `opened` orchestrate (validated on a
throwaway PR; prt run cancelled steps=0, canceller = the issue_comment run).
Isolating prt alone in `pr-flow-prt` (follow-up PR) fixed it.

The prt `orchestrate` is the only run that reports a check on the PR — see
[[ci/pr-flow-only-prt-runs-are-pr-checks]]. Why cancel-in-progress exists at all
(runner constraint): see [[ci/pr-flow-cancel-in-progress-rationale]].