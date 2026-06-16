# Issue #393 Root Cause Analysis

**Run:** [27509527916](https://github.com/kostua16/amnezia-control-panel/actions/runs/27509527916)
**Workflow:** GSD Planning Execute (scheduled)
**Date:** 2026-06-14T19:26 -- 19:38 UTC
**Model:** glm-5.2 (via ZAI)
**Turns:** 43/80 | Duration: 553s | Cost: $2.56
**Plan executed:** Phase 999, Wave 8 — npm audit quick wins

---

## 1. Root Cause: Three Interlocking Failures

### (A) PRIMARY: Test `workflow gh auth policy` broken by the agent's own changes

The Claude agent added a `security-audit` job to `ci.yml` (16 new lines). The existing test at `src/lib/__tests__/workflow-gh-auth-policy.test.ts:24-26` asserts:

```typescript
const ciWorkflow = readRepoFile('.github/workflows/ci.yml');
const optOuts = ciWorkflow.match(/require-gh-auth: 'false'/g) ?? [];
assert.equal(optOuts.length, 4);
```

The agent also modified this test file (adding 6 lines, per `git diff --stat`), likely attempting to update the expected count from 4 to 5 to accommodate the new job. However, the test still failed as `not ok 104 - workflow gh auth policy`, meaning the update was either incorrect or incomplete.

**Evidence:**
- `not ok 104 - workflow gh auth policy` — log line 106604
- Changed files include `src/lib/__tests__/workflow-gh-auth-policy.test.ts` (6 insertions, 1 deletion) — log line 133831
- Agent thinking at 109685: *"The failing test is `workflow gh auth policy`. Let me locate and read it — my new workflow likely violates a permission/auth invariant this test enforces."*
- Agent thinking at 133742: *"`npm test` now passes (exit 0). All four gates pass."* — but this was after the agent's own edit to the test, and the subsequent validation step still caught it.

The agent spent turns 30-40 attempting to fix this test (read test, edit test, re-run tests) but the fix was insufficient. The test expected exactly 4 `require-gh-auth: 'false'` in `ci.yml`; the agent's new security-audit job changed that count.

### (B) SECONDARY: `failed_tool_calls` + `uncategorized` error classification

The `scan-claude-logs.cjs` script classified TWO error-severity findings:
1. **`failed_tool_calls`** (error) — the agent's `npm run test-only` grep commands returned error-labeled tool results because test output contained `Error:` strings from passing test log lines (`# [api/users] Prisma error P2002: ...`). These are **test log output**, not actual Prisma failures. The grep pattern `grep -E "^not ok|^✖|✘|failing|Error:|AssertionError"` matched expected error messages that tests intentionally produce as part of their test fixtures.
2. **`uncategorized`** (error) — triggered by `scan-claude-logs.cjs:304-322` because the execution JSON contained `errorMessages` including `fatal: no submodule mapping found in .gitmodules for path '.claude/worktrees/improve-claude'`.

**Evidence:**
- Scan output line 140342: `Scanned Claude logs - 2 finding(s): failed_tool_calls,uncategorized`
- SCAN_HAS_ERROR_FINDINGS: `true` — line 140638
- SCAN_FINDINGS_SUMMARY: `uncategorized` — line 140639
- The classification logic at `scan-claude-logs.cjs:309-313` (Rule 7 in the run-zai post-processor) checks `SCAN_HAS_ERROR_FINDINGS == 'true'` and if so, sets `failed=true` with `reason=claude log scanner found: $SCAN_FINDINGS_SUMMARY`.
- The actual failure gate at `gsd-planning-execute.yml:183-187` (`Fail on GSD soft failure`) fires because `claude_failed == 'true'`.

### (C) CONTRIBUTING: Stray worktree directory poisoning git submodule status

At checkout time (19:26:45), `actions/checkout` ran `git submodule status` and got:

```
fatal: no submodule mapping found in .gitmodules for path '.claude/worktrees/improve-claude'
```

This happened because a previous worktree named `improve-claude` left a directory in `.claude/worktrees/` that git interprets as a submodule reference. No `.gitmodules` file exists in the repo (verified locally), so any path under `.claude/worktrees/` that matches an old worktree name triggers this error.

**Impact:** This error poisoned the `errorMessages` array in the execution JSON, which the `uncategorized` classifier then picked up as an error-severity finding, contributing to the `claude_failed=true` gate.

**Evidence:**
- Checkout log line 58: `fatal: no submodule mapping found in .gitmodules for path '.claude/worktrees/improve-claude'`
- Post-job cleanup line 140391: `fatal: No url found for submodule path '.claude/worktrees/improve-claude' in .gitmodules`
- No `.gitmodules` file exists in the repo (verified locally).

---

## 2. Why No PR/Commit

The `gsd-planning-execute.yml` workflow has a **linear gate chain**:

1. Step 10: `Execute imported GSD plan` (ZAI agent runs) — **conclusion: success** (the ZAI action itself exited 0)
2. Step 11: `Fail on GSD soft failure` — **FAILED** because `claude_failed == 'true'`
3. Steps 12-27: ALL **skipped** — Format, Validate, Repair, Commit, PR creation

The "Fail on GSD soft failure" step at line 183-187 fires when the scan-claude-logs post-processor sets `claude_failed=true`. This exits 1, which aborts the job before reaching the commit-and-push step (step 25) and PR creation step (step 27).

The changed files (5 files modified in the working tree) were **discarded** when the runner's workspace was cleaned up after job failure. No branch was pushed, no PR was created.

**Evidence:**
- Job steps log shows: step 10 `conclusion: success`, step 11 `conclusion: failure`, steps 12-27 `conclusion: skipped`
- `LAST_ATTEMPT_OUTCOME: success` (the ZAI action ran successfully — the failure came from the post-processor)
- `SCAN_IS_ERROR: false`, `SCAN_NUM_TURNS: 43`, `SCAN_HAS_ERROR_FINDINGS: true`

---

## 3. Why No Proper Explanatory Comment

The `report-failure` action (`action.yml:264-421`) generates the issue body from a template that concatenates:
- A metrics table from `renderClaudeExecutionSection()`
- Failed steps list
- Log tails (last 3000 chars of job logs)

The `claude-failure-reason` input IS passed to `report-failure` (line 434 of the workflow: `claude-failure-reason: ${{ steps.gsd.outputs.claude_failure_reason }}`), but this value (`claude log scanner found: uncategorized`) is a **machine classification label**, not a human-readable explanation.

**Missing:** There is no step that generates a human-readable root-cause summary such as "The agent's npm audit job broke the `workflow gh auth policy` test which checks the exact count of `require-gh-auth: 'false'` in ci.yml." The `report-failure` action only renders metrics; it does not analyze the execution JSON to extract what went wrong.

**Evidence:**
- Issue #393 body contains only metrics table, changed files list, and raw log tail
- The "Error" field shows `claude log scanner found: uncategorized` — the classifier's label
- No human-readable root-cause text appears anywhere in the issue body
- The triage bot comment at 19:39:51 shows similar superficial classification: "Auto-fix workflow failed with Prisma test errors and worktree submodule configuration issue" — the Prisma errors are a **red herring** (test log output, not actual failures)

---

## 4. Timeline

| UTC | Event |
|-----|-------|
| 19:26:41 | Runner starts, checkout begins |
| 19:26:45 | `git submodule status` hits `improve-claude` stray dir — checkout recreates repo from scratch |
| 19:27:18 | Environment setup complete, branch prepared |
| 19:27:19 | Phase 999 Wave 8 plan imported, ZAI execution begins |
| 19:27 -- 19:33 | Agent reads plan, creates tasks, implements 3 npm audit quick wins across ci.yml, supply-chain.yml, new npm-audit-scheduled.yml |
| ~19:32:03 | Agent edits `workflow-gh-auth-policy.test.ts` to update expected count |
| 19:33:19 | Agent runs `npm run test-only`, sees 1 failure (`not ok 104 - workflow gh auth policy`) |
| 19:33:43 | Agent re-runs test with targeted grep, confirms `workflow gh auth policy` is the failing test |
| 19:34:01 | Agent identifies the test; reads it and begins fixing |
| 19:34 -- 19:36 | Agent continues attempting fixes, re-running tests |
| 19:36:29 | Agent believes tests pass (thinking: "npm test now passes (exit 0)") — but the exit was from grep pipeline, not the actual test |
| 19:37:10 | ZAI execution completes (conclusion: success, 43 turns) |
| 19:37:27 | `scan-claude-logs.cjs` runs, produces 2 error-severity findings: `failed_tool_calls` + `uncategorized` |
| 19:37:32 | Post-processor Rule 7: `SCAN_HAS_ERROR_FINDINGS=true` -> sets `claude_failed=true`, `reason=claude log scanner found: uncategorized` |
| 19:37:32 | `Fail on GSD soft failure` step fires `exit 1` |
| 19:37:32 | All subsequent steps (format, validate, commit, PR) skipped |
| 19:37:32 | Post-job cleanup: `git submodule foreach` hits `improve-claude` stray dir again |
| 19:37:45 | `report-failure` job starts |
| 19:38:42 | Issue #393 created with metrics dump |

---

## 5. Remediation Recommendations

### 5.1 Clean stray worktree dirs (HIGH priority, immediate)

The `.claude/worktrees/improve-claude` directory (or git index entry) needs removal from the repo. Run:

```bash
git rm -rf .claude/worktrees/improve-claude 2>/dev/null; git commit -m "chore: remove stale worktree reference"
```

Also check if `.claude/worktrees/` is in `.gitignore`. If not, add it. This prevents future worktree cleanup from leaving git-tracked detritus that poisons `git submodule status`.

### 5.2 Make `uncategorized` from stray worktree non-fatal (MEDIUM priority)

In `scan-claude-logs.cjs:304-322`, the `uncategorized` classifier treats ALL `errorMessages` not matching known patterns as error-severity. The `fatal: no submodule mapping` message from checkout is NOT a Claude execution error — it is a checkout infrastructure issue. Options:
- Filter out `fatal: no submodule mapping` from `errorMessages` before classification
- Add a specific finding category `stale_worktree` with `warning` severity instead of `error`

### 5.3 Don't classify test-stdout error strings as `failed_tool_calls` (MEDIUM priority)

The `failed_tool_calls` finding fires because Bash tool results from `npm run test-only` contain `Error:` strings in stdout (from test fixtures like `# [api/users] Prisma error P2002: ...`). The scan script counts these as failed tool calls. Consider:
- Only counting `is_error: true` tool results, not error strings in stdout
- Or ignoring `failed_tool_calls` as an error-severity finding when `conclusion === 'success'` (currently only downgraded to warning when conclusion is success AND turns < max AND is_error=false, per `scan-claude-logs.cjs:169-189`)

### 5.4 Generate human-readable root-cause text in failure issues (LOW priority)

The `report-failure` action should analyze the execution JSON and scan findings to produce a 1-2 sentence root-cause summary beyond the machine classifier label. The triage bot also produced a misleading summary ("Prisma test errors") — the Prisma messages were test fixture output, not actual failures.

---

## 6. Prisma P2002/P2025: Red Herring Clarification

The `# [api/users] Prisma error P2002: Unique constraint failed` lines in the test output are **expected test fixture log messages** from passing tests (tests in `src/lib/__tests__/` that simulate API error scenarios). They are NOT actual Prisma database failures. The grep pattern `Error:` in the agent's diagnostic command matched these log lines and classified them as tool errors, creating the misleading `failed_tool_calls` finding.

The actual single test failure was `not ok 104 - workflow gh auth policy` — an assertion count mismatch in `ci.yml` caused by the agent adding a new job.

---

## 7. Open Questions

1. Is `.claude/worktrees/improve-claude` still present on the main branch? A `git ls-tree HEAD` check would confirm. If so, it needs to be removed. If it was already removed, the checkout error came from a stale runner cache.
2. The agent's thinking at 19:36:29 claims "npm test now passes (exit 0)" — but the test actually still failed. The agent appears to have misinterpreted the exit code of its grep pipeline (`echo "exit ${PIPESTATUS[0]}"` showed `exit 0` because grep exited 0, not because the test exited 0). This is an agent reasoning error. Should the workflow add a validation gate that independently verifies `npm test` exit code rather than trusting the agent's report?
3. Should the `workflow gh auth policy` test use a `>=` comparison instead of exact count, so adding new CI jobs doesn't break it?

---

**Status:** DONE
**Summary:** Run 27509527916 failed because (1) the agent's npm audit changes broke the `workflow gh auth policy` test (exact count assertion in ci.yml), (2) the scan classifier flagged stray worktree submodule errors and test-stdout error strings as fatal findings, and (3) the post-processor's Rule 7 made any error-severity finding fatal, blocking commit/PR creation.
**Concerns/Blockers:** The `improve-claude` stray worktree reference needs cleanup on main branch to prevent recurrence.
