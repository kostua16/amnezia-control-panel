# Quick Task 260531-qyb: Refactor scan-claude-logs Into Tested CJS Scanner

## Goal

Move the large `scan-claude-logs` shell logic from `run-claude-params` into a local CJS script with tests, while preserving all existing action outputs and Claude health behavior.

## Tasks

1. Add `.github/workflows/scripts/scan-claude-logs.cjs`.
2. Preserve current finding categories, severities, details, issue JSON shape, and GitHub outputs.
3. Shrink `.github/actions/run-claude-params/action.yml` to minimal shell glue for log download and script invocation.
4. Add local tests for pure scanner functions and CLI output behavior.
5. Verify with tests, lint, Prettier, action YAML parsing, and diff whitespace checks.
