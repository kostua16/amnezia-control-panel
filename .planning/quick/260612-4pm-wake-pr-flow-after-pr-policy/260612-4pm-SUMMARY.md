---
status: complete
date: 2026-06-12
---

# Summary

Fixed a shared PR orchestration gap where `pr-flow.yml` treated `PR Policy` as a required check in `.github/pr-flow.json` but did not wake itself when that workflow completed. On automation PRs #324 and #325, `pr-flow` ran after CI finished, observed `PR Policy` still in flight, set `flow/checks-pending`, and never revisited the PR head after `PR Policy` turned green.

Updated `.github/workflows/pr-flow.yml` so the `workflow_run` trigger includes `PR Policy`, which gives the orchestrator the missing post-policy wakeup and lets it advance from stale pending state into review/finalizer decisions.

Added a regression assertion in `src/lib/__tests__/pr-flow-watchdog.test.ts` so future workflow edits keep the `PR Policy` wakeup in place.

## Verification

- `/Users/kostua16/go/bin/actionlint .github/workflows/pr-flow.yml`
- `node --test src/lib/__tests__/pr-flow-watchdog.test.ts`
- `npm run lint`
- `npm run format:check`
- `graphify update .` when `graphify-out/graph.json` is present
