# Quick Task 260815-r3p: Fix PR #1085 review findings (AFX-E02 ledger hardening)

## Description

Address the three review findings on PR #1085 (review comments r3789360450,
r3789360451, r3789360452) per the implementation-ready fix plan received on
the hive channel (conversation `task-007-fix`). No speculative CI changes; the
16 reported check failures are runner-outage queuing (dev6 + mac1 offline), not
code failures.

## Source

- PR: kostua16/amnezia-control-panel#1085 (head b10fa777, branch `agent/ryan-mstoh2c8`)
- Issue: #1072 (AFX-E02, part of umbrella #678)
- Review findings:
  1. r3789360450 — `loadLedger` trusts entry structure; shape errors mislabeled
     as "not valid JSON"; downstream `TypeError` risk.
  2. r3789360451 — re-reported/regressed findings keep stale `severity`/`details`.
  3. r3789360452 — exempted ledger content rides the safe lane with no
     structural validation before merge.

## Implementation Steps

1. **Schema validation** (`.github/workflows/scripts/audit-findings-ledger.cjs`)
   - Split JSON syntax errors (`Ledger file is not valid JSON: <path>`) from
     structural errors (`Ledger file has invalid structure: <path>: <reason>`).
   - Exported `validateLedger(ledger)`: version === 1; `findings` array;
     unique 16-hex fingerprints matching `fingerprintFinding({summary, files})`;
     status ∈ {open, manual, fixed}; severity ∈ centralized enum
     {critical, high, medium, low, unspecified}; non-empty string
     summary/details; ISO-shaped first_seen/last_seen with first_seen <=
     last_seen; string last_seen_run; `files` array of non-empty strings;
     fixed entries require `fixed_in_run`, non-fixed must not have it.
   - `loadLedger` runs structural validation after parse. Missing-file
     initialization preserved only for append/list-open; `--validate` requires
     the file to exist.
2. **Metadata refresh on dedup/regression**
   - Manual re-report (open/manual existing) and fixed→open paths copy current
     finding's severity, summary, details, files before bumping
     last_seen/last_seen_run. Fingerprint + first_seen stay stable.
   - Incoming severity normalized through the centralized enum so the writer
     can never emit a ledger the loader rejects.
3. **`--validate` CLI mode**
   - Exactly-one-of append/list-open/validate.
   - Read-only, fails on missing file, prints concise success line, nonzero
     exit with precise structural error otherwise.
4. **Gate wiring**
   - `validate-pr-gate/action.yml`: new ledger-validate step, continue-on-error,
     outcome exposed + aggregated into `gate_passed`.
   - `ci.yml` `test` job: run `--validate` on the checked-out PR head.
   - `docs/workflow-e2e-scenarios.md`: malformed-ledger safe-lane rejection
     scenario row.

## Files to Modify

- `.github/workflows/scripts/audit-findings-ledger.cjs`
- `.github/workflows/scripts/__tests__/audit-findings-ledger.test.cjs`
- `.github/actions/validate-pr-gate/action.yml`
- `.github/workflows/ci.yml`
- `docs/workflow-e2e-scenarios.md`

## Tests to Add

- `--validate` exits 0 on valid seed/ledger without changing bytes; exits
  nonzero when the file is missing.
- Invalid JSON keeps the syntax-specific message; invalid top-level
  object/version gets a structure-specific message.
- Table-driven malformed entries: fingerprint shape, fingerprint/content
  mismatch, duplicate fingerprint, bad status, bad severity, bad files,
  missing/ill-typed required strings/timestamps, fixed_in_run invariants,
  impossible timestamp ordering — API + CLI fail clearly.
- manual→manual and open→open refresh severity/details/summary/files,
  preserve first_seen/fingerprint; fixed→open refreshes and drops
  fixed_in_run.
- Refreshed severity changes list-open ordering.

## Success Criteria

- All new + existing ledger tests green; policy exemption tests untouched-green.
- `npm run lint`, `npm run format:check` green on changed files.
- `node --test scripts/__tests__/*.test.cjs` (from `.github/workflows`) green
  modulo documented pre-existing Windows-host failures.
- `npm run test-only` green modulo the 2 documented pre-existing
  resource-monitor platform mismatches.
- Scenario doc updated; commits reference AFX-E02 / #1072.

## Out of Scope

- Runner outage recovery (dev6/mac1 offline) — infrastructure, escalated to
  hive operator, not a code change.
- Salted issue-dedup fingerprint (AFX-E06 scope).
