---
id: 261122-m3o
issue: 1156
branch: ci/pr-flow-skip-unchanged-success-statuses
status: complete
---

# Summary: skip unchanged success commit statuses in the PR orchestrator

## What changed

- `.github/workflows/scripts/orchestrate-pr-flow.cjs`
  - `shouldPublishStatus(previousStatusByContext, status, currentRunUrl)` (exported): returns `false` only when the latest status of the context on the head SHA is `success`, the new status is `success`, the descriptions match after `truncateStatusDescription`, and the target_url is stable (equal to the previous one, or the new one is the current orchestrator run URL). Everything else returns `true`.
  - `publishFlowStatuses(pr, visibility, { readStatuses, publishStatus, currentRunUrl })` (exported, injectable): reads the current statuses once, only when at least one status to publish is `success`; a read that throws or returns an unexpected shape yields an empty index, so every status is posted (fail open).
  - The status list is read fresh at publish time (no per-run memo): `prt` and `wake` runs use separate concurrency groups and can overlap on the same head, so a snapshot taken earlier in the wake could be stale. Cost: one extra status read per wake that has a `success` to publish; benefit: the unchanged-success POSTs are skipped. `indexStatusesByContext` picks the newest entry per context by `created_at` (first-wins when unusable) instead of trusting array order.
  - `fetchCommitStatuses` now requests `commits/{sha}/status?per_page=100` so the pr-flow contexts cannot fall off the default 30-item page.
  - The error-visibility path (`publishCommitStatus(pr, errorVisibility.aggregate)`) is untouched and still posts unconditionally.
- `.github/workflows/scripts/__tests__/orchestrate-pr-flow.test.cjs`: 13 new tests (identical success skipped, volatile current-run URL skipped, description compared after truncation, changed description posts, changed worker URL posts, missing/different link posts, pending/failure/error always posted, previous state differs posts, no previous status posts, ordering preserved, read throws posts all, unexpected read shape posts all, no read when nothing is a success). Reader and poster are injected; no real `gh`.
- `docs/workflow-e2e-scenarios.md`: scenario row V13 in §5b.

## Test results

Baseline on clean `origin/main` (Windows, `core.autocrlf=true`):

- `npm run test-only`: 871 tests, 866 pass, 5 fail.
- `cd .github/workflows && node --test scripts/__tests__/*.test.cjs`: 1272 tests, 1261 pass, 11 fail.

With the change:

- `npm run test-only`: 871 tests, 866 pass, 5 fail; failing set identical to baseline.
- workflow suite: 1285 tests (+13), 1274 pass, 11 fail; failing set identical to baseline.
- `orchestrate-pr-flow.test.cjs` alone: 63 tests, 63 pass.
- `npx prettier --check` on the three changed files: clean.
- `npx eslint --no-ignore` on the two changed `.cjs` files: no findings (the repo ESLint config ignores `.github/**`, so the default run skips them).

The baseline failures are the CRLF regex tests caused by `core.autocrlf=true` plus a few tests that depend on the Windows checkout; none touch the orchestrator.

## Residual risks

- A skipped success status keeps a link to an older orchestrator run (accepted cosmetic effect).
- `fetchCommitStatuses` now uses `per_page=100`, which also changes the list handed to `evaluate-external-review.cjs` (up to 100 contexts instead of 30); only more complete, but it is a visible behavior difference for that consumer.
- The skip relies on the orchestrator being the only writer of `pr-flow/*` contexts and on the status read at the start of a wake still being current at publish time; this holds while the orchestrator runs serialized per PR.
- Not exercised against live GitHub: behavior was verified with injected readers/posters and the existing suites, not with a real wake.
