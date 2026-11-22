---
id: 261122-ppc
issue: 1164
branch: ci/pr-flow-graphql-bulk-read
files:
  - .github/workflows/scripts/lib/review-inputs-graphql.cjs
  - .github/workflows/scripts/lib/sticky-comment.cjs
  - .github/workflows/scripts/orchestrate-pr-flow.cjs
  - .github/workflows/scripts/compare-review-input-sources.cjs
  - .github/workflows/scripts/__tests__/review-inputs-graphql.test.cjs
  - .github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs
  - docs/workflow-e2e-scenarios.md
---

# Plan: one GraphQL read per wake reused for statuses, sticky comment and head date

Issue: #1164. Depends on #1163 (merge that first). Goal: move three more REST reads per wake (`commits/{sha}`, `commits/{sha}/status`, `issues/N/comments`) to the near-idle GraphQL bucket without changing any decision.

## Facts (verified)

- After #1156/#1157 the GraphQL adapter `lib/review-inputs-graphql.cjs` (`fetchReviewInputsGraphql`) already returns REST-shaped `comments` (issue comments with `user.login`, body), `reviews`, `reviewComments`, `checkRuns`, `statuses` (state, description, target_url, created_at). It runs only inside `collectExternalReview`, i.e. only when the PR is not draft, required checks passed and the PR is not dependabot.
- REST reads that remain on every non-draft wake: `fetchHeadCommittedAt` -> `GET commits/{sha}` (`resolve-pr` step), `fetchCommitStatuses` -> `GET commits/{sha}/status` (publish step reads it fresh, deliberately: prt and wake runs use separate concurrency groups and can overlap on one head), `listComments` in `lib/sticky-comment.cjs` (`issues/N/comments --paginate`).
- Bot-login rule: GraphQL returns `kilo-code-bot` / `github-actions` for Apps with `__typename: Bot`; REST returns the `[bot]` form. `lib/kilo.cjs` must not be widened. `findExistingComment` compares `comment.user.login === 'github-actions[bot]'`, so the adapter must append `[bot]` for Bot authors (already done in #1157) and expose the REST numeric id as `id` (use `databaseId`), since update/delete use `issues/comments/{id}`.
- GraphQL `rateLimit { cost }` was 1 on 52 of 53 PRs, 3 where pagination was needed.

## Review corrections (independent review, verified; these override the text below where they conflict)

- **UPDATE after #1166 merged (supersedes the next bullet): the head commit date is now needed on EVERY wake.** The worker-run lookup (`lib/worker-runs-by-head.cjs`, merged in #1166) trusts the repo-wide `workflow_dispatch` window only when `pr.headCommittedAt` is known and the window reaches back to it; a missing date forces the per-workflow fallback (11 REST reads). So do NOT make the date lazy. Instead stop paying a separate REST read for it: take `committedDate` of the PR's last commit from a GraphQL source that is already fetched every wake or is one cheap addition (for example the `gh pr view --json ... commits` call that `fetchPullRequest` already makes, reading the last commit's `committedDate`, falling back to `authoredDate`; or the bulk snapshot query), and keep REST `fetchHeadCommittedAt` only as the fallback when that value is missing. Verify the date equals the REST `commit.committer.date` for every open PR in the parity script (mismatch blocks) and that the worker lookup still takes the head path for the same PRs as before (5 of 23 at last measurement, all fresh heads).
- **(superseded by the UPDATE bullet above, kept for history) Head commit date is only needed by the Kilo review evaluation.** Its only consumer is `evaluateExternalReview` (`normalizeHeadCommittedAt`), yet `resolve-pr` calls `fetchHeadCommittedAt` on every wake. Move that read into `collectExternalReview`: populate `pr.headCommittedAt` there (GraphQL `committedDate`, falling back to `authoredDate`, throw `ReviewInputsUnavailable` if neither exists; REST `fetchHeadCommittedAt` on fallback or `rest`). This saves one REST read on every wake where the review is not evaluated (draft, checks pending/failed, dependabot) with no extra query.
- **No early snapshot for write-time decisions.** `prt` and `wake` runs use separate concurrency groups (`pr-flow.yml:68`) and can overlap, so statuses AND the sticky-comment list used at write time must be read fresh at the visibility step, not reused from `collectExternalReview` (a stale comment id would make `upsertComment` POST a duplicate and DELETE a comment the other run already removed). Rule: in the `visibility` step (non-dry-run) do one publish-time GraphQL read with `wantComments: true`, `wantContexts: hasSuccessStatus`, `wantReviews: false`, `wantThreads: false`, and hand its fresh `statuses` to `publishFlowStatuses` and its fresh `comments` to `upsertFlowComment`; each falls back independently to REST `fetchCommitStatuses` / `listComments`.
- **Adapter hardening.** Select `committedDate authoredDate`; throw `ReviewInputsUnavailable` if any issue comment lacks a positive integer `databaseId` (a null id would turn into `DELETE issues/comments/null`). `id`, the `[bot]` suffix and lowercase status `state` are already shipped by #1157/#1159; do not re-implement them. Add `.github/workflows/scripts/__tests__/sticky-comment.test.cjs` to `files:` for the pre-fetched `comments` parameter.
- **`statusCheckRollup.contexts` mixes `CheckRun` and `StatusContext` in 100-item pages**, so the publish-time read must paginate `contexts` when it needs statuses.
- **Merge order.** Both plans touch `upsertFlowComment` / `upsertComment`; implement #1164 on top of the merged #1163 (`skipIfUnchanged` + `stabilizeRunLinks`), pass the fresh `comments` through that same path.

## Behavior

1. **Query/adapter.** Extend the existing query and adapter with `headCommittedAt` (`commits(last:1){nodes{commit{oid committedDate}}}`) and numeric comment ids; keep the head-oid guard and all fail-closed rules from #1157. Expose a thin `readPrSnapshot(pr)` returning `{ reviewInputs, statuses, comments, headCommittedAt }` or throwing `ReviewInputsUnavailable`.
2. **Reuse points** (each independent; each falls back to its current REST read on any problem):
   - `headCommittedAt`: use the snapshot value; else `fetchHeadCommittedAt` REST.
   - sticky comment lookup: `upsertComment` accepts an optional pre-fetched `comments` array; the orchestrator passes the snapshot's comments; else `listComments` REST. The orchestrator still applies `skipIfUnchanged` from #1163.
   - status snapshot for `publishFlowStatuses`: read at publish time through a fresh snapshot query (GraphQL) with REST `fetchCommitStatuses` as fallback. Never reuse a snapshot taken earlier in the wake for publish decisions. Statuses from GraphQL must lowercase `state` and carry `description`, `target_url`, `created_at` so `shouldPublishStatus` sees the same shapes as REST.
3. **Switch.** Reuse the existing `PR_FLOW_REVIEW_SOURCE` (`graphql|rest`) so one variable rolls back both review inputs and these reads; `rest` restores the exact current behavior.

## Tasks

1. Extend the adapter and add `readPrSnapshot` with tests (committedDate mapping, numeric comment id, Bot suffix on comment author, no widening of `KILO_LOGINS`, pagination and head-guard failures throw).
2. Wire the three reuse points with fallbacks; one warning per fallback, never more than one GraphQL snapshot read per wake plus one fresh read at publish.
3. Extend `compare-review-input-sources.cjs` to also diff `headCommittedAt`, sticky-comment resolution (which comment id `findExistingComment` returns) and the statuses after `shouldPublishStatus` (post/skip list per context) between REST and GraphQL on all open PRs plus the last 30 merged PRs. Read-only. Zero differences required; paste the table.
4. Instrumented count (writes intercepted): REST calls per wake before/after on 3 PRs, pasted in the PR.
5. Docs: scenario rows in `docs/workflow-e2e-scenarios.md`; tests mapping line.

## Verification (all required, paste results in the PR)

- `npm run test-only` and `cd .github/workflows && node --test scripts/__tests__/*.test.cjs` vs clean `origin/main` failing sets (Windows CRLF baseline; `checkout-before-local-action` also fails on Windows at baseline).
- `npx prettier --check` and `npx eslint --no-ignore` on changed `.cjs`.
- Parity table with zero differences; any difference blocks.

## Out of scope

Triggers/concurrency, label writes, status writes (REST only: there is no GraphQL mutation for commit statuses), `watch-pr-flow.cjs`, `makeDecision`.

## Rollback

Repository variable `PR_FLOW_REVIEW_SOURCE=rest`, or revert.
