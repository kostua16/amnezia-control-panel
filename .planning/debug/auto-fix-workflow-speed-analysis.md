# Debug: Auto-Fix Workflow Speed Analysis

**Run:** #25995377927 (Auto Fix CI Failures - Direct Push)
**Status:** failure
**Total duration:** ~17.3 min
**Constraint:** No changes to GSD skills usage or dependency installation steps

## Step Timing Breakdown

| Step | Duration | % of Total |
|------|----------|------------|
| Set up job | 2s | 0.2% |
| Checkout code (`fetch-depth: 0`) | 1s | 0.1% |
| Setup git identity | 0s | 0% |
| Create fix branch | 0s | 0% |
| Get CI failure details | 1s | 0.1% |
| **Setup environment** (node + npm ci + GSD) | **29s** | **2.8%** |
| **Fix CI failures with Claude** | **1004s (16.7 min)** | **97%** |
| Check for changes → Post steps | 1s | 0.1% |
| report-failure job (separate runner) | 4s | 0.4% |

## Historical Comparison (branch auto-fix)

| Run ID | Duration | Conclusion |
|--------|----------|------------|
| 25995377927 | 17.3 min | failure |
| 25993219679 | 18.5 min | failure |
| 25993138847 | 9.7 min | failure |
| 25993111687 | 20.3 min | cancelled (timeout) |
| 25993012742 | 9.9 min | failure |

**Pattern:** Claude action step dominates (95-97%). Pre-Claude steps total ~33s consistently.

## Findings — What CAN Be Improved (excluding GSD + deps install)

### F1. Warm TypeScript cache before Claude step (estimated save: 30-60s per fix cycle)
**Impact:** HIGH — Claude's early-exit protocol runs `npx tsc --noEmit` after each fix cycle. First run is cold (no `.tsbuildinfo`), subsequent runs are incremental. If we warm the cache during setup, every tsc call inside Claude is faster.

**Change:** Add a step between setup-environment and Claude action:
```yaml
- name: Warm TypeScript cache
  run: npx tsc --noEmit 2>/dev/null || true
```
This populates `.tsbuildinfo` so Claude's `npx tsc --noEmit` calls during fix cycles are incremental (~2-3s) instead of cold (~10-15s). With 3-5 fix cycles, that's 30-60s saved.

**Risk:** None — tsc exit code ignored, just warms cache.

### F2. Shallow clone instead of `fetch-depth: 0` (estimated save: 0-5s now, grows with repo)
**Impact:** LOW now, MEDIUM as repo grows — full history clone will slow down.

**Current:** `fetch-depth: 0` (full history)
**Proposed:** `fetch-depth: 1` (shallow)

Auto-fix creates a new branch from HEAD — no git history needed. Full clone unnecessary.

**Risk:** None for auto-fix workflow. `git checkout -b` from HEAD works fine with shallow clone.

### F4. Add `Bash(node:*)` to allowedTools (no time save, reduces Claude friction)
**Impact:** NONE for speed, but prevents Claude from wasting turns requesting permission to run `node` commands.

**Current allowedTools:** `Bash(git:*)`, `Bash(bun:*)`, `Bash(npm:*)`, `Bash(npx:*)`, `Bash(gh:*)`
**Missing:** `Bash(node:*)` — Claude may need `node -e` for quick validation.

### F5. Skip auto-fix for transient failures (save: entire run for transient errors)
**Impact:** HIGH when transient, ZERO for real failures.

**Current:** Every CI failure triggers auto-fix, even if it's a transient infrastructure issue (runner OOM, network timeout, rate limit).
**Proposed:** Add a check in `Get CI failure details` step — scan failure logs for known transient patterns:
- `ETIMEDOUT`, `ECONNRESET`, `ENOTFOUND`
- `rate limit`, `throttle`
- `Runner cancelled`, `The runner has received a shutdown signal`
- `out of memory`, `OOM`

If all failed steps match transient patterns, skip the auto-fix and create an issue with `transient-failure` label instead.

**Risk:** Could miss a real fix if a legitimate error coincides with a transient message. Mitigation: only skip if ALL failed steps are transient.

### F6. Pre-generate Prisma client in setup (save: 1 Claude turn if tsc needs it)
**Impact:** LOW-MEDIUM — if the TypeScript error involves Prisma types, Claude will hit type errors without the generated client, wasting a turn diagnosing "missing types" before realizing it needs to run `prisma generate`.

**Current:** `setup-environment` has `generate-prisma: "true"` option but both auto-fix workflows pass `"false"`.
**Proposed:** Set `generate-prisma: "true"` in both auto-fix workflows.

**Risk:** None — `prisma generate` is fast (~1-2s) and idempotent.

### F7. Consolidate git identity + branch creation (save: trivial)
**Impact:** NEGLIGIBLE — these steps are already <1s combined. Not worth the complexity.

## Recommendations (Priority Order)

| # | Finding | Effort | Save | Priority |
|---|---------|--------|------|----------|
| F1 | Warm TypeScript cache | Trivial (1 line) | 30-60s | HIGH |
| F6 | Enable Prisma generate | Trivial (1 word) | 1 Claude turn | MEDIUM |
| F5 | Skip transient failures | Medium (20 lines) | Entire run when transient | MEDIUM |
| F2 | Shallow clone | Trivial (1 word) | 0-5s (growing) | LOW |
| F4 | Add `Bash(node:*)` | Trivial (1 word) | Prevents wasted turns | LOW |

## Unresolved Questions

- Is there data on how many auto-fix runs hit transient failures vs real code issues? This would validate F5's impact.
- Should F5 be a separate workflow (`check-transient.yml`) or inline in existing workflows?
