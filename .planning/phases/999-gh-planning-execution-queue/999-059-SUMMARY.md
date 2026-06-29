# Summary: Plan 999-059 — Apply PR labels once after creation

## Status: DONE

## What was done

- Confirmed the `upsert-pull-request` composite action already avoids `--label` on `gh pr create` and applies labels via `gh pr edit --add-label` post-creation (create path) and on update (edit path).
- Added 4 structural invariant tests in `.github/workflows/scripts/__tests__/upsert-pr-label-dedupe.test.cjs`:
  1. `gh pr create` must not use `--label` flag
  2. Labels are applied via `gh pr edit --add-label`
  3. Label application failures are tolerated (non-blocking)
  4. Labels are not applied twice on the create path

## Self-Check: PASSED

- `npm test` passes (tsc, unit tests, lint, prettier all clean — 0 errors, 4 pre-existing warnings unrelated to change)

## Key files created

- `.github/workflows/scripts/__tests__/upsert-pr-label-dedupe.test.cjs`

## Key files modified

- None (action.yml was already correct)

## Notable deviations

- The action.yml already implemented the correct pattern (no `--label` on create, `--add-label` on edit, single post-create label application). No code change was needed — the task's value is the invariant test that locks this behavior in.

## Proposals deferred

None — all source-artifact tasks addressed.
