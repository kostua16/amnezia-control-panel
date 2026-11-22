---
quick_id: 260815-n6m
status: complete
type: execute
requirements: [AFX-E02]
duration: ~45min
completed: 2026-08-15
commits:
  - eb4f2d9d test(ci): add failing tests for audit-findings ledger (AFX-E02, #1072)
  - d08811bc feat(ci): persist audit-findings ledger across audit-fix runs (AFX-E02, #1072)
  - cc530a1c test(ci): add failing audit-safe ledger exemption tests (AFX-E02, #1072)
  - b0811625 fix(ci): use os.tmpdir in classify-audit-fix tests for portability (AFX-E02, #1072)
  - 5de2a0b3 feat(ci): exempt audit findings ledger from safe-lane manual paths (AFX-E02, #1072)
  - 58c0521c feat(ci): wire findings ledger into audit-fix workflow (AFX-E02, #1072)
  - d714f238 feat(ci): seed findings ledger and align audit-fix knowledge layer (AFX-E02, #1072)
---

# Quick Task 260815-n6m: AFX-E02 — Persistent audit-findings ledger across audit-fix runs

Audit-fix runs now append every reported finding (fixed and manual) to a
committed ledger at `.planning/audit-backlog.json` on the same PR commit,
consume the backlog at the start of each audit, and the ledger file rides
safe-lane audit PRs via an exact-path `auditSafe.ledgerPath` policy exemption
(fail-closed when unconfigured; every other `.planning/**` path stays
manual-only).

## What was built

### Task 1 — Ledger script (lib + CLI) with unit tests
- `.github/workflows/scripts/audit-findings-ledger.cjs` (~250 lines, CommonJS,
  `runCli()` guarded by `require.main`): `collectFixedFindings`
  (`fixed_findings`/`fixedFindings`), `loadLedger` (ENOENT → empty v1 ledger;
  corrupt JSON → hard error naming the path, exit 1), `appendToLedger`
  (unsalted `fingerprintFinding` dedup; status machine
  open/fixed/manual with fixed-wins on same-run duplicates and
  fixed→open regression), `serializeLedger` (2-space JSON + trailing newline,
  findings sorted by fingerprint, stable field order, `fixed_in_run` only when
  fixed), `listOpenEntries` (severity rank critical>high>medium>low>unspecified,
  then last_seen desc), CLI `--append` XOR `--list-open` (conflict → exit 2),
  `changed/added/updated/open_count` GITHUB_OUTPUT, and a no-write guard when
  zero findings parsed (no empty-diff churn).
- `.github/workflows/scripts/upsert-audit-manual-findings.cjs`: additive
  exports only (`normalizeFinding`, `parseJsonMaybe`); salted fingerprint
  behavior untouched (AFX-E06 scope preserved).
- `.github/workflows/scripts/__tests__/audit-findings-ledger.test.cjs`: 12
  tests covering dedup across runs with different finding_ids, status
  transitions, regression, both-lists fixed-wins, zero-findings no-write,
  corrupt-ledger CLI failure, list-open ordering, deterministic serialization
  (field-order assertions), file-order fingerprint insensitivity, and two CLI
  integration tests (spawn) including the Task 3 smoke scenario
  (F-01 → F-99 keeps one entry, bumps last_seen).

### Task 2 — `auditSafe.ledgerPath` policy exemption with regression tests
- `.github/workflows/policy.json`: `"ledgerPath": ".planning/audit-backlog.json"`
  inside `auditSafe` (exact path string, no glob).
- `evaluate-pr-policy.cjs` `evaluateAuditSafePolicy`: exact string-equality
  exemption from BOTH the manual-only and disallowed checks; empty-string
  default never matches → fails closed. Ledger still counts toward
  `maxFiles`/`maxChangedLines`.
- 4 new tests in `evaluate-pr-policy.test.cjs`; all pre-existing tests green.

### Task 3 — Workflow integration, seed ledger, docs, full gates
- `audit-fix.yml`: prompt paragraph (read the ledger first, re-report open/
  manual entries) + hard rule (ledger is read-only for the agent); new
  `update_ledger` step (id `update_ledger`) directly after "Detect manual
  audit findings" and before "Restore composite action files", env-wired to
  `structured_output`/`claude_last_output`/`github.run_id`; gate `if` extended
  with `steps.update_ledger.outputs.changed == 'true'` so a ledger-only diff
  still goes through validate → commit-and-push (manual lane, expected).
- `.planning/audit-backlog.json` seeded as `{ "version": 1, "findings": [] }`.
- `.claude/agents/kos-audit-fix.md`: checklist line mirroring the prompt.
- `docs/workflow-e2e-scenarios.md`: §4 characterization rows AF-L1/AF-L2/AF-L3
  and mapping note for `audit-findings-ledger.test.cjs` +
  `evaluate-pr-policy.test.cjs` coverage.

## Must-have truths verification

| Truth | Evidence |
|---|---|
| Same finding across runs (different finding_id, same summary+files) → one entry, preserved first_seen, bumped last_seen/last_seen_run | `audit-findings-ledger.test.cjs` "re-reporting a finding with a different id dedupes into one entry" + CLI smoke (F-01 → F-99) |
| Audit-safe PR touching src allow-listed files + ledger stays auto-merge eligible | `evaluate-pr-policy.test.cjs` "audit-safe findings ledger rides safe-lane PRs" (asserts `eligible`, `manual_only`, empty `matched_manual_paths`) |
| Any other `.planning/**` file still forces manual-only lane | "other planning paths still force audit-safe PRs into the manual lane" |
| Ledger append happens before gate/commit-and-push, riding the same PR commit | `update_ledger` step ordering in `audit-fix.yml`; e2e suite green |
| No agent code changes but manual findings → ledger-only PR (manual lane) | extended gate condition `update_ledger.outputs.changed == 'true'`; characterized AF-L2 |
| Zero findings → ledger file untouched | `appendToLedger` `changed` guard + "zero findings leave the ledger unchanged and unwritten" test |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Repo-wide manual-only glob would still block safe-lane ledger PRs**
- **Found during:** Task 2 GREEN phase
- **Issue:** The plan only exempted `ledgerPath` inside `evaluateAuditSafePolicy`,
  but `evaluatePrPolicy` separately matches every file against top-level
  `policy.manualOnlyPathGlobs` (`.planning/**`) and blocks non-exempt PRs. The
  must-have truth "remains eligible for auto-merge" could not hold.
- **Fix:** Applied the same exact-path exemption in `evaluatePrPolicy`,
  scoped to audit-safe branches only (`auditSafeConfig.ledgerPath` when the
  head ref matches `safeBranchPrefix`; empty default fails closed).
- **Files modified:** `.github/workflows/scripts/evaluate-pr-policy.cjs`
- **Commit:** 5de2a0b3

**2. [Rule 3 - Blocking issue] classify-audit-fix tests hardcoded `/tmp`**
- **Found during:** Task 2 verify (mandated command includes the file)
- **Issue:** `mkdtempSync('/tmp/caf-test-')` fails on non-POSIX hosts
  (ENOENT on Windows), blocking the required verification gate.
- **Fix:** Derive the temp root from `os.tmpdir()`; logic unchanged.
- **Files modified:** `.github/workflows/scripts/__tests__/classify-audit-fix.test.cjs`
- **Commit:** b0811625

**3. [Rule 3 - Blocking issue] Worktree had no node_modules / prisma client**
- **Found during:** Task 3 full gates
- **Issue:** `js-yaml` MODULE_NOT_FOUND in the e2e suite; `@/generated/prisma/client`
  MODULE_NOT_FOUND in `npm run test-only`.
- **Fix:** `npm ci` + `npm run prisma:generate` (standard setup, no code change).

### Environment notes (not deviations)

- `core.autocrlf=true` on this Windows worktree makes `prettier --check` flag
  every checked-out file (`.prettierrc` enforces LF). Content-level compliance
  of every changed file was verified by diffing LF-normalized content against
  prettier output — all clean. Several YAML-grep test failures had the same
  CRLF cause and pass after working-tree LF normalization (zero git diff;
  `git diff --numstat` confirms only intended changes are staged/committed).
- 7 e2e-suite tests and 2 `test-only` tests fail on this Windows host for
  pre-existing platform reasons (path separators, timezone, POSIX `gh` stub,
  drive letter vs mocked `df`); all pass on the Linux CI runners. Details and
  file-by-file causes: `deferred-items.md` in this directory. None touch files
  modified by this task.

## Verification results

- `node --test scripts/__tests__/audit-findings-ledger.test.cjs scripts/__tests__/upsert-audit-manual-findings.test.cjs` — 28/28 pass.
- `node --test scripts/__tests__/evaluate-pr-policy.test.cjs scripts/__tests__/classify-audit-fix.test.cjs` — 40/40 pass.
- Full e2e suite `node --test scripts/__tests__/*.test.cjs` — 1265 tests,
  1258 pass, 7 pre-existing Windows-only failures (see deferred-items.md); all
  tests covering changed files pass.
- `npm run test-only` — 867 tests, 865 pass, 2 pre-existing Windows-only
  failures (`resource-monitor.test.ts` platform mismatch, untouched files).
- `npm run lint` — 0 errors, 4 pre-existing warnings in untouched src files.
- Targeted prettier — all changed files clean (content-level; see environment note).
- Task 3 smoke: `--append` with F-01 → one entry written; second `--append`
  with F-99 → single entry, `last_seen_run` bumped to smoke2; `--list-open`
  prints `[medium] manual a5eef485797ed5e0 smoke (files: 1) last_seen_run=smoke2`.

## TDD Gate Compliance

- Task 1: RED commit eb4f2d9d (suite failed on missing module) → GREEN commit
  d08811bc (28/28 pass).
- Task 2: RED commit cc530a1c (ledger-rides test failed: `false !== true`) →
  GREEN commit 5de2a0b3 (40/40 pass).

## Threat model dispositions

- T-afx02-01 (agent edits ledger): mitigated — prompt hard rule + kos-audit-fix
  checklist line; workflow is sole writer.
- T-afx02-02 (exemption widens auto-merge): mitigated — exact string equality,
  fail-closed, regression test for other `.planning/**` paths.
- T-afx02-03 (malformed output corrupts ledger): mitigated — corrupt ledger is
  a hard CLI failure (exit 1 → report-failure); malformed structured output
  parses to zero findings → no write.
- T-afx02-04 (unbounded growth): accepted as planned (fingerprint dedup bounds
  growth by distinct findings).

## Known Stubs

None — no placeholder or stub code was introduced.

## Open follow-ups

- Deferred Windows-host test portability items: `deferred-items.md`.
- Issue-level cross-run dedup remains salted (AFX-E06 scope, untouched).
