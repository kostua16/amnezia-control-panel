---
id: 261122-m4e
issue: 1157
status: complete
---

# Summary: Kilo review inputs via GraphQL with REST fallback

## What changed

- `lib/review-inputs-graphql.cjs` (new): one cursor-paginated GraphQL query returning the REST shapes `evaluateExternalReview` consumes. Throws `ReviewInputsUnavailable` on a non-zero exit, an `errors` array, a missing structural field, more than 10 pages for a connection, a review thread with more than one page of comments, or a head oid that differs from the evaluated SHA (also checked on every follow-up page).
- Bot logins: `author.__typename === 'Bot'` gets `[bot]` appended; `lib/kilo.cjs` and `KILO_LOGINS` are untouched, so a human account named `kilo-code-bot` is never trusted.
- `orchestrate-pr-flow.cjs`: `collectExternalReview(pr, { source, loadRest, loadGraphql, evaluate })` with the selector `PR_FLOW_REVIEW_SOURCE` (`graphql` | `rest`, empty = default `graphql`, unknown value = `rest`). Any GraphQL failure falls back to the unchanged REST fetchers for that wake. All REST fetch functions are kept. `publishFlowStatuses` is not touched.
- `pr-flow.yml`: orchestrate step env `PR_FLOW_REVIEW_SOURCE: ${{ vars.PR_FLOW_REVIEW_SOURCE || '' }}` (rollback = repository variable, no commit).
- `compare-review-input-sources.cjs` (new): read-only parity script (`--pr`, `--open`, `--merged`).
- `__tests__/review-inputs-graphql.test.cjs` (new, 24 tests) and `docs/workflow-e2e-scenarios.md` (R21-R23, mapping).

## Parity (real `gh`, 23 open + 30 most recently merged PRs)

53/53 verdicts identical, 0 GraphQL fallbacks, `rateLimit { cost }` 1 for 52 PRs and 3 for the one PR that needed pagination (#877). Default is therefore `graphql`.

Normalized-input differences (comments, review comments, reviews and statuses had none on all 53 PRs):

- Only `checkRuns` differ. REST reads one page (30 runs); on PRs with more check runs the Kilo check can sit on page 2 and REST misses it (12 PRs: Kilo check absent in REST, `success` in GraphQL). GraphQL is the more complete side. Verdicts match because the Kilo check was `success`; if it were `cancelled`/`skipped` the GraphQL path would now honor it where REST silently could not.
- The status rollup lists fewer runs than the REST list (latest per check, no superseded suites). None of the dropped entries were Kilo checks.

## Tests

- `npm run test-only`: 691 tests, 661 pass, 30 fail; origin/main: 691 / 661 / 30; identical failing set (Windows `core.autocrlf=true` CRLF regexes, plus environment-dependent tests).
- `cd .github/workflows && node --test scripts/__tests__/*.test.cjs`: 1296 tests, 1285 pass, 11 fail; origin/main: 1272 / 1261 / 11; identical failing set; the +24 are the new tests, all pass.
- `prettier --check --end-of-line auto` and `eslint --no-ignore` on the changed `.cjs`: clean.

## Residual risks

- GraphQL and REST can disagree for one wake when a Kilo check is beyond REST's first page (GraphQL is correct there).
- A repository-wide GraphQL outage is covered by the per-wake REST fallback; rollback is `PR_FLOW_REVIEW_SOURCE=rest`.
- `EXPECTED` status state is kept as `expected` (never `pending`), so it cannot start the Kilo wait timer.
- `node_modules` for the test runs was a junction to the parent checkout, which explains 30 baseline failures here instead of the 5 noted in the plan; the delta against origin/main is zero.
