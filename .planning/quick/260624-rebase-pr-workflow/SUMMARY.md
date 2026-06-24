---
status: complete
---

# `/rebase` Branch-Refresh Workflow — Complete

Implemented `.github/workflows/rebase-pr.yml` + supporting scripts per `.planning/ideas/rebase-wf-plan.md`.

## Outcome

- Trigger policy `rebase-pr` mode: exact-body `/rebase`, maintainer-only, PR-only, dispatch (rejects prose + `/rebase main`).
- Eligibility narrower than merge — only `do-not-merge` blocks a rebase (manual-only / needs-review / ai-review-concerns / security-review-concerns block merge, not refresh).
- Clean rebases push with `--force-with-lease`, no AI; conflicts go to `run-zai` (opus) with review feedback pre-fetched.
- Sticky summary covers started / conflict-working / complete / validation-failed / push-rejected / skipped / failed; gate outcomes authoritative (dual-block on failure).
- `validate-pr-gate` decides the push; clean no-op (head current) skips gate+push.

## Verification

- `npm run test-only`: 639/639
- script e2e (`scripts/__tests__/*.cjs`): 255/255
- typecheck, eslint, prettier (direct), actionlint: all clean
- `workflow-triggers.test.ts` concurrency guard passes

## Notes

- Only script logic + YAML static checks are locally verifiable; real Actions execution (actual rebase, run-zai conflict path) is CI-verified — inherent to workflow changes.
- Needs a `/rebase` smoke test on a throwaway PR after merge.
