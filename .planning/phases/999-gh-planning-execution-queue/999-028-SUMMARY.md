---
plan: 999-028
phase: 999
status: complete
source_artifact: ".planning/quick/260430-r2n-npm-port-shorthand/260430-r2n-PLAN.md"
source_artifact_sha256: 7b1db988992b0124bc2356b400fb32d54bd583b520e49735e5f760cf8f4f5d2c
---

# Plan 999-028: support npm --port shorthand and clarify Next multi-server behavior

## Summary

Source artifact already fully implemented in commit `52c4242` (`chore(dev): support npm --port shorthand`). Both `scripts/dev.cjs` and `scripts/start.cjs` contain `resolvePortFromNpmShorthand()` which normalizes npm shorthand patterns so operators can use `npm run dev --port 3334` without the `--` separator. Task 2 (clarify Next limitation) was documented in the quick-task summary — Next.js blocks multiple `next dev` processes for the same project directory regardless of port.

## Changes

No new code changes. Verified existing implementation:

- **`scripts/dev.cjs`** — `resolvePortFromNpmShorthand()` handles:
  - `npm run dev --port=3334` (npm sets `npm_config_port=3334`)
  - `npm run dev --port 3334` (npm sets `npm_config_port=true`, passes `3334` as argv)
  - `npm run dev -- --port 3334` still works (standard `--` passthrough)
  - Default port 3333 when unspecified
  - `PORT` env and `-p`/`--port` args take precedence over npm shorthand

- **`scripts/start.cjs`** — Same `resolvePortFromNpmShorthand()` pattern for production mode

## Verification

- Lint: 0 errors, 3 warnings (pre-existing `set-state-in-effect` warnings, unrelated)
- TypeScript: No errors
- Prettier: All files formatted correctly
- Tests: Pass (exit 0)

## Key Files

- `scripts/dev.cjs` — dev server launcher with npm port shorthand support
- `scripts/start.cjs` — production launcher with npm port shorthand support
- `.planning/quick/260430-r2n-npm-port-shorthand/260430-r2n-SUMMARY.md` — original quick-task completion record

## Self-Check: PASSED

- [x] All tasks from source artifact addressed
- [x] Existing implementation verified correct
- [x] Lint, typecheck, prettier, tests all pass
- [x] No modifications to shared orchestrator artifacts
