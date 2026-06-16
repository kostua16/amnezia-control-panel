# Issue #363 Root Cause Analysis — `[github-runs-monitor] GitHub runs monitor failed`

**Run:** https://github.com/kostua16/amnezia-control-panel/actions/runs/27463481283
**Date:** 2026-06-13T09:55:31Z — 10:06:22Z
**Model:** glm-5, 22 turns, 490s, $1.67, 21 tool calls (Bash:16, Read:3, Edit:1, Write:1)
**Failed step:** `Monitor GitHub Actions Runs / Verify changed files`

---

## 1. Root Cause

**The "Verify changed files" step failed because Prettier rejected the `.planning/debug/ci-workflow-script-test-coverage.md` file that the Claude agent created.**

The agent produced 2 file changes:
1. `.planning/debug/ci-workflow-script-test-coverage.md` (Write — new debug report)
2. `package.json` (Edit — purpose unclear from available data)

The Claude SDK reported `is_error: false` and `outcome: success`. The agent finished normally. The failure happened in a **post-agent verification step** that the workflow runs after Claude completes.

### Failure chain

1. Claude agent ran `/gsd:debug` prompt, inspected 3+ other CI runs (including `rtk proxy gh run view 27459809333 --log-failed` and `rtk proxy gh run view 27439950803 --log-failed`), read `ci.yml`, `package.json`, and an existing debug report. It then wrote a new debug `.md` file and edited `package.json`.
2. Agent completed (turn 22, `is_error: false`, `lastOutput: ""`).
3. Workflow step "Verify changed files" ran. Its bash script classifies changed files by extension:
   - `monitor-amnezia-control-panel-github-runs.yml:281` — `*.md)` glob matches ANY markdown file, including `.planning/debug/*.md`.
4. The `.md` file was added to `prettier_targets` array.
5. `npx prettier --check` was called with the explicit file path as argument.
6. **Prettier checks explicit file arguments bypassing `.prettierignore`** (which excludes `.planning/**`).
7. Prettier reported: `[warn] .planning/debug/ci-workflow-script-test-coverage.md` → `Code style issues found`.
8. Step exited with code 1 (`set -euo pipefail`).

**Citation:** Failed log line `2026-06-13T10:05:02.4593710Z [warn] .planning/debug/ci-workflow-script-test-coverage.md` followed by `2026-06-13T10:05:02.4666817Z ##[error]Process completed with exit code 1.`

### Why the agent created a badly-formatted .md file

The agent was given a `/gsd:debug` prompt that instructed it to "produce a concise report of runs inspected, status, durations, and why no PR should be created." It wrote that report to `.planning/debug/ci-workflow-script-test-coverage.md` using the `Write` tool. The agent either:
- Did not run `npx prettier --write` on the file it created (the prompt says to run `--check` but not `--write`, and the prompt only mentions prettier for `*.yml` changes, not `.md` files).
- Or ran `--check` which passed locally (because `.prettierignore` excludes `.planning/`), giving false confidence.

The verification instructions in the prompt (`monitor-amnezia-control-panel-github-runs.yml:191-196`) say:
- "If you change workflow or action YAML, run `actionlint` and `npx prettier --check <changed files>`."
- No mention of running prettier on `.md` files the agent creates.

But the "Verify changed files" step (`monitor-amnezia-control-panel-github-runs.yml:281`) explicitly adds `*.md` to prettier targets — a mismatch between what the prompt tells the agent to verify and what the workflow gate actually checks.

---

## 2. Why No PR/Commit

The workflow step chain is:

```
Verify changed files (line 236) → Detect duplicate (line 323) → commit-and-push (line 353) → Build PR body (line 364) → Create PR (line 387)
```

"Verify changed files" has **no `continue-on-error`** and runs unconditionally. When it exited 1, GitHub Actions stopped the job — all subsequent steps were skipped (confirmed by `conclusion: "skipped"` on steps 10-15 in the run metadata).

The `commit-and-push` step at line 353 has condition `if: steps.duplicate.outputs.duplicate_found != 'true' && steps.duplicate.outputs.overlap_found != 'true'` but no condition guarding against a prior step failure. Since the job was already failed, it never ran.

**No branch was pushed. No PR was created. The agent's changes (both files) were discarded with the runner.**

**Citation:** Run metadata shows steps 10-15 all have `"conclusion":"skipped"`. Git log confirms `.planning/debug/ci-workflow-script-test-coverage.md` was never committed to any branch.

---

## 3. Why No Proper Explanatory Comment

The `lastOutput` field in the metrics JSON is **empty string** (`"lastOutput":""`). The `CLAUDE_LAST_OUTPUT` env var passed to the "Write monitor summary" step was also empty (confirmed in the summary step output: `(no output captured)`).

The issue body contains only:
- Generic metrics table (auto-generated from `render-claude-report.cjs`)
- Generic "Auto-fix Workflow Failure" intro template
- Failed tool samples (raw command output, not diagnostic prose)
- Log tails (last 3000 chars of job log, which is mostly git config noise)

**There is no root-cause explanation anywhere because:**
1. The agent's `lastOutput` was empty — the agent did not produce a final summary text block, or the SDK did not capture it.
2. The `report-failure` action (`report-failure/action.yml:369-401`) uses only `renderClaudeExecutionSection` for the Claude section, which renders metrics + `lastOutput`. When `lastOutput` is empty, it renders only metrics.
3. There is no mechanism to generate a human-readable diagnostic explaining *why* the verification step failed. The failure message is buried in the log tail as Prettier output among git config noise.

**Where such text should be generated:**
- The agent should have written a summary as its final output (the prompt asks for it at lines 198-206).
- Failing that, the "Verify changed files" step should produce a structured error annotation that the report-failure action picks up and renders prominently.

---

## 4. Agent Task Drift Analysis

The agent spent 22 turns with 16 Bash calls. The 3 failed tool samples all involve `rtk proxy gh run view <other-run-id> --log-failed` — inspecting other CI runs. The agent:
- Read `.github/workflows/ci.yml` and `package.json`
- Inspected runs 27459809333 (another auto-fix CI failure) and 27439950803 (a PR policy failure from 2026-06-12)
- Produced only 1 Edit (`package.json`) and 1 Write (the debug `.md`)

The prompt explicitly instructs: "For each failed run you treat as actionable, inspect `rtk proxy gh run view <run-id> --json ... --verbose` and exact failed logs." So the run-inspection behavior is **prompt-directed, not drift**. The agent was doing what it was told. However, the turn budget allocation (12 investigate / 40 implement / 12 verify) was supposed to constrain this. With 22 turns used and only 2 file edits, the agent spent most of its budget investigating and relatively little implementing.

The `package.json` edit is unclear — it could have been a legitimate fix attempt or a spurious change. Without the full Claude output, we cannot determine the intent.

---

## 5. Evidence Summary

| Evidence | Source |
|----------|--------|
| Prettier rejected `.planning/debug/ci-workflow-script-test-coverage.md` | Run log `10:05:02.459` |
| `*.md` glob in Verify step matches all `.md` files | `monitor-amnezia-control-panel-github-runs.yml:281` |
| `.planning/**` is in `.prettierignore` | `.prettierignore:17` |
| Prettier ignores `.prettierignore` for explicit file args | Prettier documented behavior |
| Steps 10-15 skipped after Verify failure | Run metadata `"conclusion":"skipped"` |
| `lastOutput` was empty | Metrics JSON `"lastOutput":""` |
| Agent reported success (`is_error: false`) | Run log `10:04:56` |
| 3 failed Bash calls were all `rtk proxy gh run view` | Metrics `failedToolSamples` |
| Agent read ci.yml, package.json, existing debug report | Metrics `readFilesList` |
| Agent wrote 1 .md file, edited package.json | Metrics `editFilesList` |

---

## 6. Recommended Remediation Direction

### 6a. Fix the `.planning/` Prettier bypass (HIGH priority)

The "Verify changed files" step should exclude `.planning/**` files from Prettier checks, since `.prettierignore` already declares them out-of-scope. Options:
- Add an exclusion in the case statement: `*.md)` → check that `$file` does not start with `.planning/`
- Or remove `*.md` from prettier_targets entirely (`.md` files rarely need Prettier in CI verification; the agent's prompt already tells it to format YAML)

### 6b. Produce diagnostic output on verification failure (MEDIUM priority)

When "Verify changed files" fails, the step should:
- Write a structured annotation to `$GITHUB_STEP_SUMMARY` with the exact checker that failed and which file(s)
- Set an output like `verify_failure_reason` so downstream steps (or the report-failure action) can render it

Currently, the failure reason is only visible by digging through raw logs.

### 6c. Prompt/verification alignment (MEDIUM priority)

The prompt at `monitor-amnezia-control-panel-github-runs.yml:191-196` tells the agent to run Prettier on YAML changes but not on `.md` changes. The verify step checks `.md`. Align these:
- Either add `.md` to the prompt's verification instructions
- Or remove `*.md` from the verify step's Prettier scope

### 6d. Guard `.planning/debug/` writes (LOW priority)

The agent wrote to `.planning/debug/` — a directory that is gitignored and whose contents don't survive CI runs. The prompt says "Do not touch unrelated dirty files" but `.planning/debug/` is arguably in-scope for a debug workflow. However, since these files are never committed (gitignored), writing them wastes turns. Consider telling the agent that `.planning/debug/` notes will be discarded and it should put diagnostic content in its final text output instead.

### 6e. Separate "verification rejected" from "agent failed" (LOW priority)

Currently both cases produce the same generic issue body. The metrics show `outcome: success` but the job failed. The report should distinguish:
- "Agent crashed / timed out" (SDK-level failure)
- "Agent succeeded but post-verification rejected the output" (this case)

---

## 7. Open Questions

1. What was the `package.json` edit? Without full Claude output, we cannot determine if it was a legitimate fix or a spurious change. The edit could have been the actual fix the agent intended, with the `.md` file being incidental.
2. Was the agent's `lastOutput` truly empty, or did the SDK truncate/lose it? The `claude-full-output: 'false'` setting in the run-zai action may suppress capture of the final text block.
3. Is there a pattern of glm-5 producing badly-formatted markdown? This may be a model-specific formatting issue worth tracking.
