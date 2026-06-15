---
status: resolved
trigger: "CI run 27515214917 (Lint job) failed on format:check for src/lib/__tests__/classify-claude-retry.test.ts — monitor run 27521248850"
created: 2026-06-15
updated: 2026-06-15
---

# Debug: CI format:check failure on classify-claude-retry.test.ts

## Symptoms

- CI run 27515214917 ("CI", sha 5f7654d, push to main) → conclusion failure
- Failing job: **Lint**, step 5 "Run npm run format:check"
- Lint, Type Check, Test, Build jobs all passed
- CI log: `[warn] src/lib/__tests__/classify-claude-retry.test.ts` → "Code style issues found"
- Verified by `rtk proxy gh run view 27515214917 --log-failed`

## Evidence

- format:check script: `prettier --check "src/**/*.{ts,tsx,css}"` (src only, not workflows)
- Reproduced locally: `rtk proxy npx prettier --check src/lib/__tests__/classify-claude-retry.test.ts` → exit 1, same warn
- Commit 5f7654d only touched `.serena/memories/*.md` — test file was pre-existing, not authored by that commit
- .prettierrc: printWidth 80, singleQuote, semi, trailingComma all, arrowParens always, endOfLine lf

## Root Cause

Line 95 exceeded `printWidth: 80`. Prettier required wrapping the multi-arg
`assert.equal(...)` call. Single offending line:

```ts
assert.equal(hasAnyResultNode(JSON.stringify({ type: 'result', is_error: true })), true);
```

Not flaky, not version drift — a genuine formatting violation that slipped past
a commit without running format:check.

## Fix

Wrapped the long `assert.equal` call to satisfy Prettier:

```ts
assert.equal(
  hasAnyResultNode(JSON.stringify({ type: 'result', is_error: true })),
  true,
);
```

## Verification

- `npm run format:check` → PASS (exit 0, "All matched files use Prettier code style!")
- `npm run lint` → PASS (exit 0)
- `npx tsx --test src/lib/__tests__/classify-claude-retry.test.ts` → 8/8 pass
- git diff: single file, +4/-1, exactly Prettier's canonical form

## Files Changed

- `src/lib/__tests__/classify-claude-retry.test.ts`

## Notes

- The `[warn]` was masked in one earlier `npx prettier` call because RTK filters
  prettier output; `rtk proxy` is required to see the real exit code / warn lines.
- No PR opened per task rules — workflow handles commit/push/PR.
