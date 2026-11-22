# Why pr-flow cancel-in-progress exists + runner capacity

`cancel-in-progress` in pr-flow.yml is load-bearing: pr-flow has TWO feedback loops
that would otherwise flood the runner queue:

1. Label loop — orchestrate adds `flow/*` labels → `pull_request_target` `labeled`.
   Controlled by `evaluate-trigger-policy.cjs` prefilter (bot labels → should_run=false,
   "re-evaluates on workflow_run completion") + cancel-in-progress=false for labels.
2. Worker/check loop — orchestrate dispatches a worker / CI runs → completes →
   `workflow_run` → re-triggers pr-flow. Intentional (re-evaluate after each finish).

`cancel-in-progress` collapses redundant wakes so only the newest run per class runs.

RUNNER CAPACITY: all jobs run on GitHub-hosted `ubuntu-latest` (#1128). Each job gets
its own VM, so the limit is GitHub's concurrent-job cap (20 on the Free plan), not a
runner count. The event-class split (see [[ci/pr-flow-concurrency-groups]]) is therefore
timing-free: CI's 4 required jobs (Lint / Type Check / Build / Test, ~1 min each) run in
parallel and the extra prt orchestrate does not wait for a spare runner. Only a sustained
queue at the cap would change that; then collapse more aggressively or drop redundant
pull_request_target triggers. Rolling back to a self-hosted pool (where >=2 runners were
required, because 1 runner serialized CI and cost ~1-2 min) is described in
`docs/runbooks/self-hosted-to-hosted-runners-rollback.md`.

History note: the cancel-in-progress value flip-flopped around LABEL events
(ef78e12 / 554eadc / #290 protected labels; 6b6c662 set `true` to collapse reruns;
4d26f22 by claude[bot] auto-fix reverted to the nuanced form). The prt-vs-workflow_run
cascade was inherent to both forms — fixed only by the event-class split.