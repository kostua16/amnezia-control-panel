---
id: 261122-ppb
issue: 1163
status: complete
---

# Summary: worker runs by head sha + skip unchanged sticky comment

## What changed

- `lib/worker-runs-by-head.cjs` (new): `createWorkerRunsLoader` serves every configured worker from two REST reads, unioned by run id and grouped by workflow file basename: (a) `actions/runs?head_sha=<pr head>&per_page=100`, (b) `actions/runs?event=workflow_dispatch&per_page=100`. Read (b) is needed because workers dispatched on the base ref (fix-review -> code-review, project-manager -> dependency-review / pr-finalizer) carry the PR number and head sha only in the run title. Both reads use `--jq` to stay under the 1 MiB `execFileSync` buffer. The unchanged `matchesWorkerTitle` filter still decides what counts.
- The dispatch read goes first and its window is trusted only when it reaches back to the head commit (`total_count` is the repo-wide lifetime count and is NOT a truncation signal): it must have returned every dispatch run, or its oldest run must not be newer than the head commit, and the head commit date must be known and not ahead of the clock (5 minutes of skew allowed). Otherwise the head read is skipped and the wake uses the per-workflow lookup.
- Fallback to the unchanged per-workflow `collectWorkerRuns` (one warning for read problems and for an uncovered window, none for the expected cross-repo case): cross-repository PR, missing head sha, dispatch window not reaching the head commit / head commit date unknown or in the future / a dispatch run without a readable `created_at`, head `total_count` above one page, any thrown read, malformed response shape, unresolved repo slug.
- Rollback: `PR_FLOW_WORKER_RUNS_SOURCE` (`head` default, `legacy`, unknown value -> `legacy` with one warning), wired in `pr-flow.yml` as `vars.PR_FLOW_WORKER_RUNS_SOURCE`.
- `lib/sticky-comment.cjs`: opt-in `skipIfUnchanged` (default `false`) plus an injectable `sameBody`; the skip happens before any temp payload is written.
- `orchestrate-pr-flow.cjs`: `upsertFlowComment` passes `skipIfUnchanged: true`. `stabilizeRunLinks` keeps the stored link in rows whose new link is the volatile current-run URL (otherwise the body is never byte-identical), so only a real change (state, reason, description, worker-run link, a row gaining its first link) rewrites the comment. CRLF in the stored body is normalised.
- `compare-worker-run-sources.cjs` (new): read-only old-vs-new parity script.
- Tests: `worker-runs-by-head.test.cjs` (20), additions to `orchestrate-pr-flow.test.cjs` (9) and `sticky-comment.test.cjs` (5). Docs: `docs/workflow-e2e-scenarios.md` (R24, R25, V14, V2 wording, test mapping).
- Not touched: dispatch sites, `makeDecision`, status posting, triggers.

## Parity on the final code (real `gh`, 23 open PRs, `compare-worker-run-sources.cjs --open`)

5 PRs use the head path (10 -> 2 REST reads: #1166, #1165, #1161, #1160, #1133), 18 PRs fall back because the 100-dispatch window (about 4 h in this repository at measurement time) does not reach their head commit; those wakes cost 11 REST reads instead of 10. 115/115 worker comparisons identical, 0 regressions, 0 read errors. The fallback is the reference lookup, so correctness is unchanged; the saving applies to freshly pushed heads, which receive most wakes. A cheaper fallback for idle PRs is a possible follow-up.

## Parity before the window rule (superseded by the section above; kept as history)

51/51 PRs read through the head lookup, 0 fallbacks, 0 regressions (no run found by the old lookup was missed by the new one; every identical-set comparison agrees on active, latest, failedCount and target url). 238 worker comparisons identical, 17 "recovered" (15 PRs: 3 open, 12 merged; codeReview 15, finalizer 2): the old repo-wide `--limit 50` window had already evicted the PR's run, the new lookup still sees it. 0 PRs where the new lookup sees extra older runs next to runs the old one also saw, so retry-cap counters (`failedCount`) did not move on any PR; if that ever happens the history can only make a cap trigger sooner, never later.

Recovered runs change a decision input only where the old lookup saw "no run" although one existed. On #1075 the instrumented wake gave the same state, reason, labels and dispatch; only the code-review status link points at the real run instead of the orchestrator run.

## REST calls per wake (instrumented: writes intercepted, reads counted with `GH_DEBUG=api`)

| PR | reads legacy -> head | GraphQL | writes |
| --- | --- | --- | --- |
| #1161 | 13 -> 5 | 5 | 11 (same) |
| #1075 | 13 -> 5 | 6 | 2 / 6 (comment rewritten on head: link to the recovered run) |
| #1135 | 13 -> 5 | 6 | 2 (same) |

10 worker lookups became 2. The sticky comment was not rewritten on #1075/#1135 legacy and #1135 head (stored comment from a different run id), i.e. 2 writes saved per wake when nothing changed.

## Tests

- `npm run test-only`: 871 tests, 866 pass, 5 fail on both origin/main and this branch; identical failing set.
- `cd .github/workflows && node --test scripts/__tests__/*.test.cjs`: 1324 / 1312 / 12 on origin/main, 1358 / 1346 / 12 on this branch; identical failing set (Windows `core.autocrlf` CRLF regexes, the `checkout-before-local-action` invariant, three fake-`gh`-on-PATH tests in `sticky-comment.test.cjs`); +34 new tests all pass.
- `prettier --check --end-of-line auto` and `eslint --no-ignore` on the changed `.cjs`: clean.

## Residual risks

- Read (b) is a recency window of the last 100 `workflow_dispatch` runs repo-wide, shared by all workflows. It is used only when it reaches back to the head commit; for older heads the wake falls back to the per-workflow lookup (11 reads instead of 10). Rollback is `PR_FLOW_WORKER_RUNS_SOURCE=legacy`.
- A single snapshot per wake instead of one read per worker: a run dispatched during the wake is not seen by workers read later in the same wake (the old code had the same property for memoized workers).
- A stored comment whose rows lost their links would be rewritten once (treated as a real change).
