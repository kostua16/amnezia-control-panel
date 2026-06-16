# Why pr-flow cancel-in-progress exists + runner assumption

`cancel-in-progress` in pr-flow.yml is load-bearing: pr-flow has TWO feedback loops
that would otherwise flood the shared self-hosted runner pool:

1. Label loop — orchestrate adds `flow/*` labels → `pull_request_target` `labeled`.
   Controlled by `evaluate-trigger-policy.cjs` prefilter (bot labels → should_run=false,
   "re-evaluates on workflow_run completion") + cancel-in-progress=false for labels.
2. Worker/check loop — orchestrate dispatches a worker / CI runs → completes →
   `workflow_run` → re-triggers pr-flow. Intentional (re-evaluate after each finish).

`cancel-in-progress` collapses redundant wakes so only the newest run per class runs.

RUNNER ASSUMPTION: the event-class split (see [[ci/pr-flow-concurrency-groups]])
assumes >=2 self-hosted runners (3+ in current use, confirmed 2026-06). Measured:
CI's 4 required jobs (Lint 43s / Type Check 62s / Build 55s / Test 53s) dominate
time-to-ready; orchestrate is ~70s. The split is timing-free at N>=2 (extra prt
orchestrate rides a spare runner); at N=1 it costs ~1–2 min, and a 2nd runner
(N=1→2 roughly halves time-to-ready) is the higher-leverage fix. If downsized to 1
runner, revisit: collapse more aggressively or drop redundant pull_request_target
triggers.

History note: the cancel-in-progress value flip-flopped around LABEL events
(ef78e12 / 554eadc / #290 protected labels; 6b6c662 set `true` to collapse reruns;
4d26f22 by claude[bot] auto-fix reverted to the nuanced form). The prt-vs-workflow_run
cascade was inherent to both forms — fixed only by the event-class split.