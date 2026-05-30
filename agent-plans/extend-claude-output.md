# Plan: Enhance Claude Run Statistics

## Context

Claude Code CI runs currently expose only 4 metrics (`num_turns`, `is_error`, `failed`, `failure_reason`). The execution JSON already contains `duration_ms`, `total_cost_usd`, `permission_denials_count` but they're not surfaced. The user wants comprehensive tool-level and file-level stats including per-tool invocation counts.

**Key change:** Enable `show_full_output` on all Claude runs so tool invocations are visible in the GitHub Actions log and can be parsed for per-tool metrics.

**Problem from issue #128:** Report-failure output is nearly useless — shows "Claude Code failed with a non-rate-limit error" without the actual error context. The real error (`--json-schema was provided but Claude did not return structured_output`) is buried in the log tails but not extracted. With `show_full_output`, we can extract the actual error messages and Claude's last actions before failure.

## Implementation

### Step 1: Enable `show_full_output` in `run-claude-params/action.yml`

Change `show_full_output: ${{ inputs.claude-debug || false }}` to `show_full_output: true` in all 3 attempt blocks. This makes all Claude SDK output (tool calls, results, errors) visible in the job log.

**Files:** `.github/actions/run-claude-params/action.yml` (lines 163, 242, 321)

### Step 2: Extend `scan-claude-logs` step — extract all metrics + error context

Current: reads `num_turns`, `is_error`, `permission_denials_count` from execution JSON.

**2a. Execution JSON extraction (add to existing block):**
- `duration_ms` → execution time
- `total_cost_usd` → API cost

**2b. Error context extraction (new):**
- Extract `##[error]` lines from log → `claude_error_messages` (JSON array of error strings)
- Extract lines between "Running Claude Code via SDK" and the result JSON → `claude_last_output` (last 50 lines of SDK output for context)
- Extract the action-level error message (e.g. `Action failed with error: ...`) → `claude_action_error`
- These feed into `claude_failure_reason` to replace generic messages with actual error text

**2c. Model + rejected tools (add to existing parsing):**
- `model_used` from init message in log (`"model": "<id>"`)
- `rejected_tools_list` from `DISALLOWED_TOOLS` patterns in log

**2d. Tool invocation parsing from full log output:**
- Parse `tool_use` / `tool_name` patterns from log → count by tool name → `tool_breakdown` JSON
- Count total tool calls → `num_tool_calls`
- Count `Read` invocations → `num_read_files`
- Count `Edit`/`Write`/`MultiEdit` invocations → `num_edit_tool_calls`
- Parse tool results for errors → `num_failed_tool_calls`
- `permission_denials_count` → `num_rejected_tool_calls`

**2e. Derived metrics:**
- `turns_budget_used_pct` = `num_turns / max_turns * 100`
- `cost_per_turn` = `total_cost_usd / num_turns`
- `duration_per_turn_ms` = `duration_ms / num_turns`
- `denial_rate` = `permission_denials_count / num_tool_calls * 100`

All written to `GITHUB_OUTPUT` and included in the `RESULT` JSON.

### Step 3: Improve `claude-health` failure reason

Current failure reasons are generic ("claude-code-action step failed", "claude step did not run"). Improve to:

1. If `claude_action_error` is non-empty, use it as the reason
2. If `claude_error_messages` has entries, include top 1-2 in the reason
3. If no specific errors found, fall back to current generic messages
4. Include `duration_ms` and `num_turns` context: "claude-code-action step failed after 15 turns, 3m 45s"

This directly addresses issue #128 — the failure reason will now contain the actual error, not just "non-rate-limit error".

### Step 4: Add `collect-file-stats` step

New step after `select-outputs`, runs with `if: always()`:
```
git diff --name-only HEAD → changed_files_list
git diff --stat HEAD → num_changed_files
```

### Step 5: Extend `claude-health` step pass-through

Pass through all new outputs from `scan-logs` and `collect-file-stats` steps.

### Step 6: Add new action outputs

Add to `run-claude-params/action.yml` outputs:
| Output | Source |
|--------|--------|
| `claude_duration_ms` | execution JSON |
| `claude_duration_sec` | derived |
| `claude_total_cost_usd` | execution JSON |
| `claude_model_used` | init message |
| `claude_num_changed_files` | git diff |
| `claude_changed_files_list` | git diff |
| `claude_rejected_tools_count` | execution JSON |
| `claude_rejected_tools_list` | log parse |
| `claude_num_tool_calls` | log parse |
| `claude_num_read_files` | log parse |
| `claude_num_failed_tool_calls` | log parse |
| `claude_num_edit_tool_calls` | log parse |
| `claude_tool_breakdown` | log parse JSON |
| `claude_turns_budget_pct` | derived |
| `claude_cost_per_turn` | derived |
| `claude_duration_per_turn_ms` | derived |
| `claude_denial_rate` | derived |
| `claude_error_messages` | log `##[error]` extraction |
| `claude_last_output` | last N lines of SDK output |

Forward these through `run-claude/action.yml` and `run-zai/action.yml`.

### Step 7: Update issue tracker comment in `scan-claude-logs`

Replace current 2-line metadata (`_Attempt: X/3 | Turns: Y/Z | timestamp_`) with a detailed stats section:

```
### Claude Execution Metrics
| Metric | Value |
|--------|-------|
| Model | glm-5 |
| Turns | 15/70 (21%) |
| Duration | 3m 45s |
| Cost | $0.73 |
| Tool calls | 42 (Read: 18, Edit: 8, Bash: 12, Grep: 4) |
| Files changed | 4 |
| Rejections | 5 |
| Cost/turn | $0.05 |
| Denial rate | 11.9% |

**Error:** Action failed with error: --json-schema was provided but Claude did not return structured_output
```

### Step 8: Overhaul `report-failure/action.yml`

Add new inputs for ALL metrics + error context. Replace the current 5-line Claude Execution section with a comprehensive report that mirrors (and extends) the Step 7 tracker comment:

**New inputs** (in addition to existing `claude-turns`, `claude-is-error`, etc.):
- `claude-duration-ms`, `claude-total-cost`, `claude-model`
- `claude-num-tool-calls`, `claude-num-read-files`, `claude-num-edit-tool-calls`, `claude-num-failed-tool-calls`
- `claude-tool-breakdown`, `claude-num-changed-files`, `claude-changed-files-list`
- `claude-rejected-tools-count`, `claude-rejected-tools-list`, `claude-denial-rate`
- `claude-turns-budget-pct`, `claude-cost-per-turn`, `claude-duration-per-turn-ms`
- `claude-error-messages`, `claude-last-output`

**Rendered output** in issue/comment body:

```markdown
### Claude Execution
| Metric | Value |
|--------|-------|
| Outcome | failure |
| Attempt | 1/3 |
| Model | glm-5 |
| Turns | 0/70 (0%) |
| Duration | 0.8s |
| Cost | $0.00 |
| Cost/turn | N/A |
| Tool calls | 0 |
| Tool breakdown | _none_ |
| Read files | 0 |
| Edit calls | 0 |
| Failed tool calls | 0 |
| Files changed | 0 |
| Rejections | 0 |
| Denial rate | N/A |

**Error messages:**
- `Action failed with error: --json-schema was provided but Claude did not return structured_output. Result subtype: success`
- `Process completed with exit code 1.`

<details><summary>Last Claude SDK output</summary>

```
[Claude init message, any tool calls, result JSON]
```

</details>

<details><summary>Changed files</summary>

```
(none)
```

</details>
```

This makes every failure issue self-contained — no need to click through to the run log to understand what happened.

### Step 9: Update consumer workflows

Update 5 workflows to:
- Add new outputs to job `outputs:` blocks
- Pass new metrics to `report-failure` action calls

**Files:**
- `.github/workflows/audit-fix.yml`
- `.github/workflows/docs-drift.yml`
- `.github/workflows/maintenance.yml`
- `.github/workflows/pr-improve.yml`
- `.github/workflows/suggest-improvements.yml`

### Step 10: Write metrics plan document

Create `docs/extend_claude_metrics_plan.md` documenting:
- All metrics collected and their sources
- How to add new metrics in the future
- Log parsing patterns used
- Hook-based enhancement path for even richer data
- Future improvements (PostToolUse hook for exact counts)

---

## Files to modify

1. `.github/actions/run-claude-params/action.yml` — enable show_full_output, extend scan with error context, add collect-file-stats, extend health with better reasons, add outputs
2. `.github/actions/run-claude/action.yml` — forward new outputs
3. `.github/actions/run-zai/action.yml` — forward new outputs
4. `.github/actions/report-failure/action.yml` — overhaul Claude Execution section with full metrics table + error context + last output
5. `.github/workflows/audit-fix.yml` — update job outputs + report-failure
6. `.github/workflows/docs-drift.yml` — same
7. `.github/workflows/maintenance.yml` — same
8. `.github/workflows/pr-improve.yml` — same
9. `.github/workflows/suggest-improvements.yml` — same
10. `docs/extend_claude_metrics_plan.md` — **new file**, metrics documentation

## Verification

1. Run `audit-fix` or `maintenance` workflow manually
2. Check action outputs: `gh run view <id>` — verify new outputs present
3. Verify issue tracker comment shows the full stats table
4. Verify `report-failure` renders detailed metrics + error context (not generic "non-rate-limit error")
5. Run end-to-end and confirm new outputs propagate through all layers
6. Check that `show_full_output` doesn't leak secrets (API keys are masked by GitHub, but review log output)

---

## Extension Addendum: Safer Structured-First Implementation

The implementation should keep the richer metrics goal above, but use a safer source order:

1. Parse `${RUNNER_TEMP}/claude-execution-output.json` or the action-provided `execution_file` first.
2. Use downloaded job logs only for fallback and enrichment: action-level errors, `##[error]` lines, rejected tools, and a capped sanitized SDK excerpt.
3. Keep `show_full_output` configurable through `claude-full-output`. The private repo default is `true`; public reusable workflow extraction should flip that default to `false`.

Important corrections applied by the implementation:

- Track the last attempted Claude run separately from the last successful run so failures like issue #128 are not normalized as "claude step did not run".
- Route parsing through `.github/workflows/scripts/parse-claude-execution.cjs` rather than growing inline bash.
- Route report rendering through `.github/workflows/scripts/render-claude-report.cjs` so issue reports and tests share the same formatting path.
- Let `report-failure` parse failed job logs itself when explicit workflow outputs are unavailable, which is required for matrix jobs like `pr-improve`.
- Propagate `claude_metrics_json` through all report paths that can expose job outputs, while preserving the individual shared-action outputs for future consumers.
