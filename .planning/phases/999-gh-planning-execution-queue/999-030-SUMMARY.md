---
plan: 999-030
status: complete
---

# Plan 999-030: Refactor scan-claude-logs Into Tested CJS Scanner

## Summary

Tasks 1–3 of the source artifact were already complete: `scan-claude-logs.cjs` existed as a tested CJS module, and `action.yml` already delegates to it with minimal shell glue (log download + `node` invocation).

Added 27 unit tests covering all three exported functions:

- **buildFindings**: 20 tests verifying all 12 finding categories (action_error, permission_denials, failed_tool_calls, git_push_403, graphql_pr_fail, turn_limit_hit, zero_turns, internal_error, disallowed_tools, action_not_found, graphql_user_err, rate_limited, uncategorized), severity escalation rules, benign message filtering, and multi-finding combinations.
- **buildClaudeLogScan**: 3 tests verifying input normalization (string coercion of runId/attempt), output shape, and finding passthrough.
- **writeGithubOutputs**: 4 tests verifying GITHUB_OUTPUT key=value format, multiline delimiter usage, issue JSON file creation when findings exist, and null/undefined metric handling.

## Key Files

- `.github/workflows/scripts/__tests__/scan-claude-logs.test.cjs` — 27 tests (created)
- `.github/workflows/scripts/scan-claude-logs.cjs` — unchanged (already correct)

## Verification

- 27/27 new tests pass
- 147/147 total workflow tests pass (no regressions)
- ESLint: no issues
- Prettier: formatted correctly
