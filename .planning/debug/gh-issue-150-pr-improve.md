---
status: resolved
trigger: 'investigate and fix gh issue#150'
created: 2026-05-31T12:11:47Z
updated: 2026-05-31T12:36:52Z
---

# Debug Session: gh-issue-150-pr-improve

## Symptoms

- expected_behavior: PR improvement auto-fix workflow should either produce schema-compliant follow-up suggestions or gracefully skip when no structured output is available.
- actual_behavior: Workflow fails with `--json-schema was provided but Claude did not return structured_output. Result subtype: success`.
- error_messages:
  - `--json-schema was provided but Claude did not return structured_output. Result subtype: success`
  - `Claude soft failure: claude-code-action step failed after 0 turn(s), 0s`
  - `Process completed with exit code 1.`
- timeline: Reported by GitHub issue #150 from run 26710399100 on 2026-05-31.
- reproduction: Run the `[pr-improve] PR improvement workflow` on an input that reaches the `Analyze follow-up improvements` Claude step with `json_schema`.

## Current Focus

- hypothesis: The workflow treats a zero-turn, no-structured-output result from the Claude action as a hard failure instead of providing a deterministic fallback or avoiding schema mode when the action cannot supply structured output.
- test: Inspect workflow and helper scripts for `json_schema`, `structured_output`, and soft-failure handling.
- expecting: The issue is isolated to the PR improvement workflow or its local helper scripts.
- next_action: resolved
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-31T12:13:00Z
  observation: GitHub issue #150 reports `--json-schema was provided but Claude did not return structured_output. Result subtype: success` from run 26710399100.
- timestamp: 2026-05-31T12:14:00Z
  observation: The run log shows Claude Code received `Context prompt: /gsd-quick`, then returned `Unknown command: /gsd-quick` with `num_turns: 0`.
- timestamp: 2026-05-31T12:15:00Z
  observation: The same run installed GSD before Claude execution, but claude-code-action restored `.claude` from the trusted ref afterward, so transiently installed slash commands were unavailable.

## Eliminated

- hypothesis: JSON schema itself is malformed.
  reason: The action failed before any model turn; the execution result was `Unknown command: /gsd-quick`, not schema validation feedback from a model response.

## Resolution

- root_cause: `pr-improve.yml` started the Claude prompt with `/gsd-quick`; in pull_request_target runs the Claude action did not have that transient GSD slash command available, so it exited with a zero-turn success and no structured output.
- fix: Installed GSD and RTK assets in project mode so `.claude/commands/gsd/quick.md` and project hook settings are committed and restored from the trusted base branch before Claude starts.
- verification: Confirmed `.claude/commands/gsd/quick.md` exists, actionlint passes, committed Claude settings parse as JSON, and generated hook scripts pass `node --check`.
- files_changed: `.github/actions/setup-environment/action.yml`, `.gitignore`, `CLAUDE.md`, `.claude/**`, `.planning/debug/gh-issue-150-pr-improve.md`, `.planning/quick/20260531-project-mode-gsd-rtk-tools/PLAN.md`
