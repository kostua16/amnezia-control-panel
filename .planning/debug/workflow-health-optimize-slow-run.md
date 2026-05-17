# Debug: workflow-health-optimize slow run #25993394087

## Symptom
Run #25993394087 ("Workflow Health Check & Optimize") stuck in `in_progress` for 12+ minutes (started 14:21 UTC, still running at 14:33 UTC).

## Root Cause Analysis

### Bottleneck: Step 6 "Analyze runs and optimize workflows" (Claude Code Action)

| Metric | Value |
|--------|-------|
| Job started | 14:21:31 UTC |
| Step 6 started | 14:22:05 UTC (after 29s setup) |
| Step 6 status | `in_progress` for 11+ min |
| Step 6 engine | `anthropics/claude-code-action@v1` (LLM agent loop) |
| MAX_TURNS | **80** |
| timeout-minutes | **30** |

The Claude Code action is an iterative LLM agent — each "turn" = 1 API call + tool execution. 80 turns is the ceiling; the agent reads all workflow files, analyzes run data, potentially edits files, validates YAML, etc.

### Contributing Factors

1. **`MAX_TURNS: 80` is excessive** — most hours there are zero improvements to make. 80 turns means worst case 30 min of LLM calls. Even a no-op run burns turns analyzing before concluding "no changes."

2. **`fetch-depth: 0`** — full git history checkout for editing YAML files. Wastes ~2-5s on clone; unnecessary since we only need `.github/workflows/`.

3. **`install-deps: "true"` + `install-gsd: "true"`** — runs full `npm ci` and GSD install even though Claude only edits YAML files. No need for Node deps or GSD framework.

4. **Hourly schedule with no early-exit** — runs every hour unconditionally. If no runs failed or no optimizations found, Claude still burns turns reading/analyzing before concluding.

5. **No turn budget awareness** — the prompt says "if you find no improvements worth making, that's fine" but doesn't tell Claude to exit quickly when runs are healthy. Claude reads all workflows, analyzes all runs, then decides "no changes" — wasting turns.

### Timeline Breakdown

```
14:21:17  Run created (scheduled trigger)
14:21:19  Job "Collect Workflow Runs" starts
14:21:29  Collect job completes (10s) — found completed runs
14:21:31  Job "Analyze & Optimize" starts
14:21:33  Step 1: Set up job (1s)
14:21:34  Step 2: Checkout repo (2s) — fetch-depth: 0
14:21:36  Step 3: Setup git identity (<1s)
14:21:36  Step 4: Create branch (<1s)
14:21:36  Step 5: setup-environment (29s) — npm ci + GSD install
14:22:05  Step 6: Claude Code action starts ← BOTTLENECK (11+ min and counting)
```

## Recommendations

### High Impact
1. **Reduce `MAX_TURNS` from 80 → 15** — 15 turns is plenty for reading ~5-10 workflow files and making targeted edits. The workflow runs hourly; cumulative optimization is fine.
2. **Skip optimize job when no failures** — add condition: only run the Claude step when `collect-runs` found failures or slow runs (>5 min). Healthy runs don't need AI analysis.
3. **Drop `install-deps` and `install-gsd`** — set both to `"false"`. Claude only edits YAML files; no Node.js runtime or GSD needed.

### Medium Impact
4. **Use `fetch-depth: 1`** — shallow clone is sufficient for YAML editing.
5. **Add explicit early-exit instruction** to the prompt: "If all runs are successful and no obvious improvements jump out within 3 turns, exit immediately."
6. **Lower `timeout-minutes` from 30 → 10** — with fewer turns, 10 min is generous.

### Low Impact
7. **Cache npm deps in setup-environment** — already uses `cache: 'npm'` when `install-deps: true`, but if deps are removed, this is moot.
8. **Consider `workflow_dispatch` only** — instead of hourly cron, trigger on-demand or after CI failures.

## Status
- Run still in progress at time of analysis
- No code changes made (diagnosis only)
