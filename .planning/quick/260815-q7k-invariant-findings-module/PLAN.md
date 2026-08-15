# Quick Task 260815-q7k — #814 actionable invariant findings (task-018)

Task: task-018 (god), make issue-catch-up invariant findings actionable (#814).

## Goal

The `[claude-health] Issue-pipeline invariant findings` tracker (#814) accumulated
37 reposts whose lines say only "N inert comments, last at <ts>" / "no PR after
Nh" — no source URL, no actor, no next action, so findings linger for weeks
(#767 since 07-15, #835 at 521h). Extract detection + reporting into a pure CJS
module with typed finding records carrying explicit remediation metadata, a
stable-identity hash over normalized actionable state, and false-positive
exclusions.

## Design

`.github/workflows/scripts/lib/issue-pipeline-invariants.cjs` (pure, requires
lib/tracking-issue.cjs):

- `detectInertBotCommand({issueNumber, comments})` → finding | null with
  `count`, `last_at`, `source_comment_url`, `actor`, `trigger_path`
  (provenance: catch-up Phase 6 / legacy re-triage / unknown), `action`
  (dispatch <wf>.yml via workflow_dispatch with GH_PAT or remove the inert
  comment).
- `detectStuckFixable({issue, comments, fixAttempts, activeFixRun, now})` →
  finding | null with `age_hours`, `fix_attempts`, `last_fix_attempt_at`,
  `blocking_labels` (security/critical/needs-review/triage-failed — reported,
  not silently dropped), `linked_pr_state`, `owner`, `next_action`
  (dead-letter route / maintainer authorization / parked / dispatch
  fix-issue.yml). False positives excluded: tracking issues, exempt labels
  (keep-open/backlog/in-progress/fixed), closed state, linked PR in
  body+comments, active fix run, age < 24h, missing
  triaged+auto-fix+priority.
- `findingsHash(findings)` — sha256/16 over sorted normalized records
  `{type, number, count|fix_attempts, blocking_labels, action|next_action}`;
  volatile fields (timestamps, age_hours, urls, owner, order) excluded so
  meaningful changes repost while hourly age ticks do not.
- `renderFindingsReport({findings, generatedAt})` → `{hash, marker, body}`;
  actionable lines with source URL/actor/action (inert) and
  attempts/holds/owner/next (stuck); cap 50 + overflow line.
- `isUnchangedReport({latestBody, marker})`.

Workflow `issue-catch-up.yml`: categorize step calls the two detectors
(replacing the inline blocks); report step calls renderFindingsReport +
isUnchangedReport (replacing inline line building + hash); tracker-creation
prose updated to describe remediation fields.

Tests: new `__tests__/issue-pipeline-invariants.test.cjs` (exact #814
findings — #767 inert ×2, #1061/#1062 stuck 24h/0 attempts, #835 stuck
521h/2 attempts; dispatch markers not inert; maintainer commands not inert;
false-positive matrix; hash stability vs volatility; caps; marker dedupe),
extended `issue-catch-up-collect.test.cjs` (enriched fields through the real
embedded script + manual-hold findings), extended
`issue-catch-up-invariants.test.cjs` (module wiring contract).

## Out of scope

- Auto-closing inert comments or auto-dispatching fixes from the report step.
- Changing bucket routing outside invariant_findings.
