---
id: 261122-ppc
issue: 1164
status: complete
---

# Summary: GraphQL reads reused for the head commit date, sticky comment lookup and status snapshot

## What changed

- `lib/review-inputs-graphql.cjs`: `fetchReviewInputsGraphql` takes an optional `want` (which of comments/reviews/threads/contexts to read; all by default) so the publish step can ask for comments and statuses only. An issue comment without a positive integer `databaseId` now makes the read unavailable (a null id would become `DELETE issues/comments/null`).
- `lib/sticky-comment.cjs`: `upsertComment` accepts an optional pre-fetched `comments` list; without it the REST list is read as before.
- `orchestrate-pr-flow.cjs`:
  - Head commit date: `gh pr view --json ...,commits` (already one GraphQL call per wake) supplies the last commit's `committedDate` (then `authoredDate`) when that commit is the head; otherwise (long PR, missing or unparsable date) REST `commits/{sha}`. The date stays eager, as the worker-run lookup needs it on every wake.
  - Visibility step: one fresh GraphQL read (`readPublishSnapshot`) right before the first write gives the sticky-comment list and, only when a success status could be skipped, the commit statuses. `publishFlowStatuses` / `upsertFlowComment` each use their part and fall back on their own to `commits/{sha}/status` / `issues/N/comments`. No snapshot from earlier in the wake is reused for write-time decisions.
  - `PR_FLOW_REVIEW_SOURCE=rest` disables all three reuse points (and the `commits` field in the PR read).
- `compare-review-input-sources.cjs`: also diffs the head date, the sticky comment id and the statuses (including the post/skip answers of `shouldPublishStatus` per context) between REST and GraphQL.
- Tests: adapter (`want`, comment id hardening, Bot suffix on the sticky author, no `KILO_LOGINS` widening), head date helpers, publish snapshot fallbacks, `publishFlowStatuses` / `upsertFlowComment` / `upsertComment` pre-fetched inputs, parity helper.
- Docs: `docs/workflow-e2e-scenarios.md` rows R26, R27, V15 and the tests mapping.

## Parity (read-only, live `gh`)

All 22 open PRs and the last 30 merged PRs: Kilo verdict 52/52 identical, head commit date 52/52 identical, sticky comment id 52/52 identical, statuses and post/skip answers 52/52 identical; 0 fallbacks, 0 differences.

## REST requests per wake (writes intercepted, reads counted with `GH_DEBUG=api`)

| PR | before (REST/GraphQL) | after (REST/GraphQL) | `PR_FLOW_REVIEW_SOURCE=rest` |
|---|---|---|---|
| #1165 (review evaluated) | 5 / 6 | 2 / 7 | 10 / 5 (review inputs back on REST too) |
| #1160 (checks pending) | 5 / 5 | 2 / 6 | 5 / 5 (= before) |
| #1148 (dependabot, per-workflow worker lookup) | 14 / 5 | 11 / 6 | 14 / 5 (= before) |

The three removed REST reads per wake are `commits/{sha}`, `commits/{sha}/status` and `issues/N/comments`. Intercepted writes (status POSTs, sticky POST/DELETE with payloads) are identical before/after/rest on all three.

## Residual risks

- The publish snapshot is taken a few status POSTs before the sticky write, so a concurrent run replacing the comment in that window could leave a stale id (previously the REST list was read immediately before the write). Mitigations: the head guard, one wake per head in practice, and the next wake converges.
- `statusCheckRollup` is computed by GitHub and could briefly lag a just-posted status. The unsafe direction (a stale `success` hiding a newer non-success) is only reached when a success is skipped; the next wake re-posts.
- A very long PR (more commits than `gh` lists) falls back to REST for the date by design.
- The `--json commits` field adds commit messages to the PR read payload.

## Rollback

Set the repository variable `PR_FLOW_REVIEW_SOURCE=rest`, or revert.
