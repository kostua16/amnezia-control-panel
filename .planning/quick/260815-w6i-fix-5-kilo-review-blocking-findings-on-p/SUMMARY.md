---
status: complete
quick_id: 260815-w6i
date: 2026-08-15
---

# Quick Task 260815-w6i Summary

task-028: fix all 5 kilo-review "Address before merge" findings on PR #1092
(kilo-code-bot comment 5303359963).

## Changes

- `scripts/lib/issue-pipeline-invariants.cjs`:
  1. (W) `detectStuckFixable` now takes the caller's retry-filtered
     `fixComments` and derives BOTH `fix_attempts` (length) and
     `last_fix_attempt_at` (latest timestamp) from it — count and timestamp can
     no longer disagree across a dead-letter-retry reset.
  2. `commandTriggerPath` trims the body — indented bot commands classify as
     their command, not `unknown`.
  3. `RETRY_DISPATCH_MARKER` replaced by `DISPATCH_MARKERS` + `isMarkerAdjacent`:
     a bot command next to a `re-triage-dispatch` or `dead-letter-retry` marker
     comment is a real dispatch echo and never reported inert.
  4. `autoFixOwner` always returns `automation` (auto-fix label is a hard
     prerequisite and the repo's authorship marker); the unreachable
     maintainer branch removed from owner and `stuckNextAction`.
- `issue-catch-up.yml`: stuck wiring passes `fixComments` (already
  retry-filtered upstream) instead of `fixAttempts`.
- Tests: module suite 18→21 (indented-command classification, marker-adjacency
  exclude/non-adjacent-still-inert, retry-reset consistency); collect suite
  harness accepts `activeIssueNumbers` → stubbed runs with `head_branch:
  claude-fix-issue-<n>`; the former `assert.ok(!active || true)` no-op replaced
  by a real active-run exclusion assertion; FP test now runs all three
  fixtures (tracker, linked-PR, active-run).
- `docs/workflow-e2e-scenarios.md`: P11l updated (whitespace-tolerant trigger
  path, marker-adjacency, single-source attempts/timestamp, owner always
  automation).

## Verification

- Targeted: 21 + 15 + 12 = 48/48 green.
- Full workflow e2e: 1276 tests, 1268 pass, 8 fail — exactly the documented
  Windows-host baseline (prisma-safe-sql ×3, sticky-comment gh-stub ×3,
  format-date TZ ×1, audit-fix CRLF ×1), none touched by this diff.
- `npm run lint`: 0 errors (4 pre-existing src warnings). Prettier clean.
