---
status: complete
quick_id: 260815-q7k
date: 2026-08-15
---

# Quick Task 260815-q7k Summary

task-018 / #814: make issue-pipeline invariant findings actionable.

## Changes

- `scripts/lib/issue-pipeline-invariants.cjs` (new, pure): `detectInertBotCommand`
  (source comment URLs, actor, trigger path, deterministic dispatch-or-delete
  action), `detectStuckFixable` (attempts + last real attempt, blocking labels,
  owner, next action; FP exclusions: tracking/exempt/closed/linked-PR/active-run/
  <24h/label-shape), `findingsHash` (normalized actionable state only — volatile
  timestamps/age/order/urls excluded), `renderFindingsReport` (cap 50 + overflow,
  remediation lines), `isUnchangedReport`.
- `issue-catch-up.yml`: categorize step consumes both detectors; report step
  consumes render + dedupe helpers (inline hash/render/line-building removed);
  tracker-creation prose documents the remediation fields and the
  actionable-state dedupe.
- Tests: `__tests__/issue-pipeline-invariants.test.cjs` (18 — exact #814
  findings #767/#835/#1061-shape, dispatch-marker and maintainer-command
  non-inertness, FP matrix, hash stability/change, caps, marker dedupe);
  `issue-catch-up-collect.test.cjs` +5 through the real embedded script
  (enrichment, manual hold, fresh-stuck, FP); `issue-catch-up-invariants.test.cjs`
  rewired (module consumption contract + module API + active-run forwarding).
- `docs/workflow-e2e-scenarios.md`: P11l rewritten; test-file index updated.

## Verification

- New/extended suites: 18 + 14 + 13 = 45/45 green.
- Workflow e2e: 1273 tests, 1265 pass, 8 pre-existing Windows-host baseline
  failures (prisma-safe-sql ×3, format-date TZ ×1, sticky-comment gh-stub ×3,
  e2e-pr651 CRLF ×1) — none touched by this diff; green on Linux CI.
- `npm run test-only`: 865/867 (2 documented resource-monitor platform
  mismatches). Lint 0. Targeted Prettier clean. YAML parse + embedded-JS
  syntax (same wrapper as the test harness) + wiring assertions OK;
  actionlint binary unavailable on this Windows host (not on PATH/docker) —
  flagged in the done report.
