# Debug: GH Run #25993219679 — Auto-Fix Taking Too Long

**Status:** RESOLVED (root cause identified)
**Date:** 2026-05-17
**Run:** https://github.com/kostua16/amnezia-control-panel/actions/runs/25993219679

## Symptoms

- **Workflow:** `Auto Fix CI Failures (Direct Push)` (`ci-failure-auto-fix-branch.yml`)
- **Duration:** 18m 29s (14:13:28 → 14:31:52)
- **Outcome:** FAILURE — `Reached maximum number of turns (80)`
- **Cost:** $4.38 (7M cache-read input tokens, 81K input, 18K output)
- **No fix pushed** — all subsequent steps (commit, PR) were skipped

## Root Cause Analysis

### 1. Turn Budget Exhaustion (PRIMARY)

The Claude agent hit `MAX_TURNS: 80` and never completed. The step ran for **17m 49s** (14:14:01 → 14:31:50) before terminating.

**Why 80 turns wasn't enough:**

- **112 tool calls** across 80 turns (avg 1.4 tools/turn)
- Tool breakdown: **51 Reads, 38 Edits, 20 Bash, 1 Write**
- The agent edited **17 different files** — massive scope creep for a type-check + lint fix

### 2. Scope Creep — Agent Edited Unrelated Files

Original CI failures were simple:
- **Type Check:** 2 errors in `panel-health-checker.ts` and `real-time-broadcaster.ts`
- **Lint:** failures (likely related to same files)

The agent instead:
- Made **9 edits** to `chain-visualization.tsx` alone
- Edited 17 files across chains, routing, websocket, providers, chain presets, etc.
- Touched `chain-flow-editor.tsx`, `chain-builder.tsx`, `chain-router.ts`, `chain-layout.ts`, etc.
- This is classic LLM auto-fix scope creep — fixing cascading type errors instead of isolating the root cause

### 3. `/gsd-debug` Prompt Adds Overhead

The prompt invokes `/gsd-debug` which triggers GSD skill loading, debug session setup, checkpoint creation, etc. For a CI auto-fix, this is unnecessary ceremony — a direct "fix these type errors" prompt would be far more efficient.

### 4. `fetch-depth: 0` Adds Checkout Time

Full git history checkout for a CI fix is unnecessary. The agent doesn't need git history to fix type errors.

### 5. GSD Install Step

`install-gsd: "true"` installs the full GSD framework (skills, hooks, commands) even though the agent barely uses it and it adds setup time.

## Timeline Breakdown

| Step | Duration | Notes |
|------|----------|-------|
| Set up job | 1s | |
| Checkout code | 1s | `fetch-depth: 0` (unnecessary) |
| Setup git identity | <1s | |
| Create fix branch | <1s | |
| Get CI failure details | <1s | |
| Setup environment | 25s | Node + npm ci + GSD install |
| **Fix CI failures with Claude** | **17m 49s** | **80 turns, hit limit, FAILED** |
| Post-steps | 2s | |

## Recommendations

### HIGH IMPACT

1. **Reduce MAX_TURNS from 80 to 25-30**
   - 80 turns is too many for CI auto-fix. Most fixes need 5-15 turns.
   - Lower budget forces the agent to be focused.
   - Prompt already says "stop after 60 turns" but the agent ignores this.

2. **Replace `/gsd-debug` with a direct fix prompt**
   - `/gsd-debug` loads GSD skills, creates debug sessions, spawns subagents — all overhead.
   - Replace with a focused prompt like:
     ```
     Fix the following CI failures. Read each failing file, identify the root cause, apply minimal fix, then verify with `npx tsc --noEmit && npm run lint`.
     Do NOT edit unrelated files. Do NOT refactor.
     ```

3. **Scope-limit the prompt**
   - Add explicit file allowlist: "Only modify files mentioned in the error logs"
   - Add: "If a fix requires editing more than 3 files, STOP and report back"
   - This prevents the cascading-edit pattern seen here (17 files for 2 type errors)

### MEDIUM IMPACT

4. **Change `fetch-depth: 0` to `fetch-depth: 1`**
   - No need for full history in auto-fix. Saves checkout time and disk space.

5. **Set `install-gsd: "false"`**
   - The `/gsd-debug` skill invocation was the only reason to install GSD.
   - With a direct prompt (rec #2), GSD is unnecessary.

6. **Add early exit verification**
   - After the agent's first edit cycle, run `npx tsc --noEmit` as a separate step.
   - If it passes, skip remaining turns and proceed to commit.

### LOW IMPACT

7. **Use faster model for simple fixes**
   - The workflow uses `glm-5` (Sonnet-equivalent). For simple type/lint fixes, a Haiku-equivalent model would be faster and cheaper.

8. **Reduce error log payload**
   - `raw.slice(-5000)` per failed job sends up to 10KB of error context. For 2 failed jobs with simple type errors, this is fine, but could be trimmed further.

## Expected Outcome

Applying recommendations #1-3:
- Turns: 80 → ~15 (focused fix, no scope creep)
- Duration: ~18m → ~3-4m
- Cost: $4.38 → ~$0.50-1.00
- Success rate: higher (no turn limit exhaustion)
