---
status: resolved
trigger: 'investigate and fix gh issue #178'
created: 2026-06-02T23:00:00Z
updated: 2026-06-02T23:29:48Z
---

# Debug Session: gh-issue-178-pr-improve

## Symptoms

- expected_behavior: PR Improve should create or update the planning branch and draft planning PR after Claude returns structured suggestions.
- actual_behavior: The workflow failed in the `Upsert planning branch and draft PR` step before creating a planning PR.
- error_messages:
  - `TypeError: Cannot read properties of null (reading 'trim')`
  - `Process completed with exit code 1.`
- timeline: Reported by GitHub issue #178 from run 26852916955 on 2026-06-02.
- reproduction: Run `PR Improve` for PR #177 with `DRY_RUN=false`; the helper reaches `git fetch` with `capture: false`.

## Current Focus

- hypothesis: The helper's subprocess wrapper assumes `execFileSync` always returns stdout, but Node returns `null` when stdio is inherited.
- test: Add regression coverage for captured commands, no-output non-captured commands, and stdout isolation for non-captured commands.
- expecting: The failure is isolated to `.github/workflows/scripts/upsert-planning-pr.cjs`.
- next_action: resolved
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-06-02T23:02:51Z
  observation: Run 26852916955 failed at `.github/workflows/scripts/upsert-planning-pr.cjs:46` with `Cannot read properties of null (reading 'trim')`.
- timestamp: 2026-06-02T23:02:51Z
  observation: The last successful child output before the crash was `git fetch origin main --depth=1`, which is called with `capture: false`.
- timestamp: 2026-06-02T23:29:48Z
  observation: `execFileSync` returns `null` when stdio is inherited, so the wrapper's unconditional `.trim()` crashes after a successful command.

## Eliminated

- hypothesis: Claude analysis failed or returned invalid structured output.
  reason: The `Analyze follow-up improvements` and `Persist structured suggestions` steps both completed successfully before the helper crash.

## Resolution

- root_cause: `.github/workflows/scripts/upsert-planning-pr.cjs` called `.trim()` on the result of `execFileSync` even when the command used inherited stdio, where Node returns `null`.
- fix: Refactored the helper into a testable `main()` entrypoint, exported `run()`, and changed `capture: false` commands to capture child stdout, mirror it to stderr, and return a safe trimmed string.
- verification: `npm test`, `npm run lint`, targeted Prettier check, and `actionlint .github/workflows/pr-improve.yml` all passed after generating the ignored Prisma client for the fresh worktree.
- files_changed: `.github/workflows/scripts/upsert-planning-pr.cjs`, `src/lib/__tests__/upsert-planning-pr.test.ts`, `.planning/debug/gh-issue-178-pr-improve.md`
