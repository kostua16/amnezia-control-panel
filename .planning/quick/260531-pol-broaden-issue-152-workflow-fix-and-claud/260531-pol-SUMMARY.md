# Quick Task 260531-pol Summary

## Outcome

Implemented the issue #152 workflow turn-budget fix and broadened Claude reporting so future failures include concrete failed-tool samples.

## Changes

- Set triage and workflow-health optimizer `MAX_TURNS` to 40.
- Tightened the workflow-health optimizer prompt to rely on collected run data, skip ambiguous YAML fixes, avoid live `gh`/`git`/network investigation, and validate with local tools.
- Extended Claude execution parsing with capped, redacted failed-tool samples and failure categories.
- Exposed `claude_failed_tool_samples` through `run-claude-params`, `run-zai`, and `run-claude`.
- Added `claude-failed-tool-samples` to `report-failure`.
- Rendered failed-tool samples in failure reports and rolling Claude-health comments.
- Added structured Claude failure summaries to workflow-health collected run data.
- Updated workflow documentation and parser/renderer tests.

## Verification

- `rtk npm test`
- `rtk npm run lint`
- `rtk ./node_modules/.bin/prettier --check .github/workflows/scripts/parse-claude-execution.cjs .github/workflows/scripts/render-claude-report.cjs src/lib/__tests__/parse-claude-execution.test.ts`
- `rtk actionlint .github/workflows/triage.yml .github/workflows/workflow-health-optimize.yml`
- Composite action YAML syntax check with `js-yaml`
- `rtk git diff --check`
