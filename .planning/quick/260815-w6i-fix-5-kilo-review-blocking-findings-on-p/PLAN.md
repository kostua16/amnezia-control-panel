# Quick Task 260815-w6i — Fix 5 kilo-review blocking findings on PR #1092

task-028 / god directive: kilo-review "Address before merge" = BLOCKING. CI stall
does not block; reviews are done-criteria.

## Findings (kilo-code-bot[bot] comment 5303359963, 2026-08-15T17:19:07Z)

1. **WARNING** `lib/issue-pipeline-invariants.cjs:116` — `lastFixAttemptAt`
   ignores the dead-letter-retry reset, so `last_fix_attempt_at` can contradict
   the post-retry `fix_attempts` count.
2. **SUGGESTION** `:66` — `commandTriggerPath` doesn't strip leading whitespace;
   indented bot commands classify as `unknown` despite `COMMAND_PATTERN` matching.
3. **SUGGESTION** `:33` — `RETRY_DISPATCH_MARKER` unused; documented
   marker-adjacency logic not implemented.
4. **SUGGESTION** `:141` — `owner === 'maintainer'` branch unreachable
   (`auto-fix` label is a hard prerequisite in `detectStuckFixable`).
5. **SUGGESTION** `__tests__/issue-catch-up-collect.test.cjs:540` —
   `assert.ok(!active || true)` no-op; active-run exclusion path untested.

## Fixes

1. Single source of truth: `detectStuckFixable` accepts the caller's
   retry-filtered `fixComments` array; derives `fix_attempts` (length) and
   `last_fix_attempt_at` (latest timestamp) from it. `issue-catch-up.yml`
   passes `fixComments` instead of `fixAttempts`. Removes the contradiction.
2. `commandTriggerPath`: `const body = (comment.body || '').trim();`.
3. Implement marker-adjacency: a bot command whose body contains the
   `<!-- re-triage-dispatch -->` marker is a real dispatch echo, not inert.
   `RETRY_DISPATCH_MARKER` const used in `detectInertBotCommand` to drop such
   comments from the inert set (documented behavior now real).
4. `autoFixOwner` returns `'automation'` always under the auto-fix
   prerequisite; remove the unreachable maintainer branch from both
   `autoFixOwner` and `stuckNextAction` (keep blocking-labels hold path).
5. Test harness: `runCollect` accepts `activeRunsByIssue` fixture; stub
   `listWorkflowRunsForRepo` returns runs with `head_branch:
   claude-fix-issue-<n>`; replace no-op assert with a real exclusion test.

## Files

- Modify: `.github/workflows/scripts/lib/issue-pipeline-invariants.cjs`
- Modify: `.github/workflows/issue-catch-up.yml` (pass `fixComments`)
- Modify: `.github/workflows/scripts/__tests__/issue-pipeline-invariants.test.cjs`
- Modify: `.github/workflows/scripts/__tests__/issue-catch-up-collect.test.cjs`
- Modify: `.github/workflows/scripts/__tests__/issue-catch-up-invariants.test.cjs` (if API contract changes)

## Verification

- Targeted: `node --test` on the three test files → all green.
- Suite: `cd .github/workflows && node --test scripts/__tests__/*.test.cjs`
  (Windows baseline: 8 pre-existing failures unrelated to this diff).
- Lint + Prettier on changed files.
