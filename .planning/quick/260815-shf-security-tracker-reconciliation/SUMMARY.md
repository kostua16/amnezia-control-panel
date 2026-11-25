---
status: complete
quick_id: 260815-shf
date: 2026-08-15
---

# Quick Task 260815-shf Summary

#922 canonical advisory-matrix consolidation (task-012, MEDIUM).

## Changes

- `.github/workflows/scripts/reconcile-security-trackers.cjs` (new): pure
  helpers + injected gh runner — GHSA/CVE extraction with case-canonicalized
  dedupe, audit-side id collection (`vulnerabilities.*.via[]` objects only),
  tracker classification (security|dependencies label AND advisory marker;
  no-ID security issues → `no-advisory-id`, never auto-closed; unlabeled →
  `unrelated`), reconciliation (`fixed` only when EVERY referenced id is
  absent from the audit), stable markdown matrix. CLI over a local audit
  JSON; `gh issue list` sweep of both labels (no `--paginate` — unsupported
  there; label objects `{name}` normalized).
- `__tests__/reconcile-security-trackers.test.cjs` (new): 18 tests.

## Live result (2026-08-15, audit zero)

- 18 trackers reconciled: every referenced advisory id absent → all `fixed`.
- Open trackers #967 (GHSA-mh99-v99m-4gvg) and #1036
  (GHSA-2v37-7h3g-55p8) closed as fixed with evidence.
- #922 rewritten as the canonical matrix and closed; #952 left non-canonical
  (no advisory marker, outside the tool's scope); #955 surfaced as
  no-advisory-id for human triage.

## Verification

- New suite 18/18; workflow e2e 1266 tests / 1258 pass / 8 pre-existing
  Windows-host failures (documented baseline); test-only 865/867 (2
  documented); lint 0; targeted prettier clean.
