# CI / testing validation

## actionlint
- `actionlint` (built from source, on PATH at `~/go/bin/actionlint`) validates `.github/workflows/*.yml` AND local composite actions; catches `with:` input mismatches across action chains (e.g. run-zai/run-deepseek → run-claude-params). Run it on any workflow or `.github/actions/*` `.yml` edit before pushing.

## Tests
- Runner: `node --import tsx --test src/lib/__tests__/*.test.ts src/app/api/__tests__/*.test.ts` (or `npm run test-only`). Full gate = `npm test` = typecheck + test-only + lint + format:check.
- Workflow/action behavior tests are STATIC: they read the `.yml`/`.sh` as TEXT and regex-match it (see `src/lib/__tests__/run-claude-params-turn-budget.test.ts`). No live action execution — assertions describe the artifact, they don't run it.

## Prisma generate — common false-failure
- `src/generated/prisma/` is gitignored; `@/generated/prisma/client` is produced by `npx prisma generate`.
- In a fresh worktree/checkout, tests + typecheck fail with `Cannot find module '@/generated/prisma/client'` (and TS2307/TS7006 cascade) until you run `npx prisma generate`. CI does this automatically via setup-environment `generate-prisma: 'true'`, so such failures are LOCAL-ONLY, not real regressions. Verify with `npx prisma generate && npm run test-only` before trusting a red test.

## Pre-commit (for `.js`/`.cjs`/`.ts`/`.tsx`, incl. `.github` workflow helper scripts)
- ESLint + Prettier must pass. package.json `format:check` only covers `src/**/*.{ts,tsx,css}` — for `.yml`/workflow files, run `npx prettier --check <changed files>` directly.

## Gotcha: scout-block hook
- The scout-block hook rejects `grep`/command patterns containing the literal token `node_modules`. Don't include `node_modules` in a grep pattern; scope exclusions via `.ckignore` (`!node_modules`) if truly needed.
