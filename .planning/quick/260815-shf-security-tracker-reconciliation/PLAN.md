# Quick Task 260815-shf — #922 security-tracker reconciliation

Task: task-012 (god), canonical advisory matrix on #922 (MEDIUM).

## Goal

One tested helper that reconciles dependency-security tracker issues against a
fresh `npm audit --json`: normalizes GHSA/CVE ids, classifies trackers
(security/dependencies labels + advisory markers; no-ID and unrelated issues
ignored), and marks a tracker fixed only when EVERY referenced advisory id is
absent from the audit. Use it to drive #922's canonical matrix and the
closures of #967 / #1036 / #922. #952 stays non-canonical (untouched).

## Design

`.github/workflows/scripts/reconcile-security-trackers.cjs` (pure helpers +
injected gh runner, CLI over a local audit file):

- `extractAdvisoryIds(text)` — GHSA/CVE regexes, canonical uppercase, deduped.
- `advisoryIdsFromAudit(auditJson)` — ids from `vulnerabilities.*.via[]`
  url/title (+ direct string entries skipped); empty audit → `[]`.
- `classifyTracker(issue)` — `security-tracker` (security|dependencies label
  AND ids present) | `no-advisory-id` (label, no ids — never fixed-marked) |
  `unrelated`.
- `reconcileTrackers({trackers, presentIds})` — per-tracker `fixed` (zero
  referenced ids present) | `open-vulnerable` (matched ids listed).
- `renderMatrix(result)` — stable markdown matrix.
- CLI: `--audit-file <path> [--repo owner/repo] [--json]`.

Tests `__tests__/reconcile-security-trackers.test.cjs`: security-only label,
dependencies label, no-ID security issue ignored, unrelated ignored,
partial (one id still present → open-vulnerable), fully resolved, audit id
extraction incl. empty audit, normalization/dedupe/case, stable matrix,
CLI parse.

## Out of scope

- Wiring into a scheduled workflow (manual/agent-driven closure tool).
- npm-overrides.md edits (already extended by PR #1088 — avoid stacking).
