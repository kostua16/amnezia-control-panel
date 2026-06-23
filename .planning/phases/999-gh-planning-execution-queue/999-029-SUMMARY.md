# Summary 999-029: Broaden Issue 152 Workflow Fix and Claude Reporting

## Status
COMPLETE

## What Changed

### 1. Triage turn budget (triage.yml)
- Raised `MAX_TURNS` from 15 to 40
- Prevents premature turn exhaustion on complex triage tasks (issue #152)

### 2. Workflow-health optimizer prompt (workflow-health-optimize.yml)
- Added `## GLOBAL CONSTRAINT` block prohibiting `git`, `gh`, `curl`, and live network/API commands across ALL phases
- Previously only Phase 3 (EXECUTE) had the prohibition; Phase 1 (ASSESS) and Phase 2 (PLAN) had no explicit ban
- Removes per-phase duplication of the same constraint

### 3. Shared Claude metrics — no changes needed
- `parse-claude-execution.cjs` already parses `failedToolSamples` (capped at 5) from execution JSON and log fallback
- `run-claude/action.yml` and `run-claude-params/action.yml` already expose `claude_failed_tool_samples` output
- `render-claude-report.cjs` already renders samples in `<details>` collapsible blocks
- `report-failure/action.yml` already passes samples through to issue/comment bodies

### 4. Workflow-health input quality — no changes needed
- `compactClaudeSummary()` already includes `failedToolSamples`, `actionError`, `errorMessages`
- `collect-runs` job already parses failed job logs with `parseClaudeExecution` and includes `claudeSummary` in `failureLogs`

## Verification
- `npm test`: 120/120 workflow e2e tests pass
- Prettier: all files clean
- actionlint: no findings on changed workflow YAML files

## Files Modified
- `.github/workflows/triage.yml` — MAX_TURNS 15 → 40
- `.github/workflows/workflow-health-optimize.yml` — global constraint added to optimizer prompt

## Proposals deferred
None — all proposals from the source artifact were addressed (2 required code changes, 2 verified as already implemented).
