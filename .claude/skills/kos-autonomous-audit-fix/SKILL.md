---
name: kos-autonomous-audit-fix
description: Run an autonomous repo audit for tech debt/code smells/missing tests, implement TARGETED fixes, verify, and reconcile — the shared discipline of audit-fix and audit-auto-prs, including their disk-exhaustion and over-broad-fix failure modes.
user-invocable: true
when_to_use: "When the audit-fix or audit-auto-prs workflow runs an autonomous audit-and-fix cycle, or when such a run failed (disk / over-broad fix / no reconcile)."
category: utilities
argument-hint: "[scope or 'full']"
keywords: [audit, audit-fix, tech-debt, code-smell, reconcile, autonomous, disk]
related: [kos-runner-disk-hygiene, kos-claude-turn-budget, kos-commit-and-push-branch, kos-gh-automation-tooling, kos-zai-run-failure-prevention]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from audit-fix.yml + audit-auto-prs.yml prompts + disk-exhaustion failure (run 28097503249)
  license: repo
  version: "1.0"
---

# Idea

`audit-fix` and `audit-auto-prs` run `/gsd:audit-fix`: audit the repo for debt/smells/missing tests, implement **targeted** fixes, verify, and stop once findings are addressed. The sample shows `audit-fix` mostly cancelled (concurrency supersession — normal) with one hard failure: **runner disk exhaustion** (`No space left on device`) during setup. The behavioral risk is over-broad fixing (refactors disguised as audit fixes → review-blocking diffs). The skill keeps fixes surgical, verified, reconciled, and disk-safe.

## When to invoke this skill directly

- You are running an autonomous audit-fix cycle.
- An audit-fix run failed on disk / produced an over-broad diff / skipped reconcile.

## References

- `audit-fix.yml`, `audit-auto-prs.yml` prompts (`/gsd:audit-fix`).
- `.github/workflows/scripts/classify-audit-fix.cjs` — classifies the run outcome.
- `.github/workflows/scripts/reconcile-audit-issues.sh` — reconciles audit issue tracking.
- `.github/actions/ensure-disk-space/` — prevents the disk-exhaustion failure.
- `report-failure` action — files the failure issue on red.

## Communication Style

Findings → targeted fix per finding → verification → reconcile. Cite file:line per finding. State diff size.

## Core Principles

YAGNI / KISS / DRY. Targeted fixes only — one finding, one minimal change. Verify with the real test command. Reconcile issue tracking so duplicates don't accumulate. Ensure disk before heavy setup.

## Your Approach

1. Audit across categories (debt, smells, missing tests) — enumerate concrete findings (file:line).
2. For each: implement the **minimal** fix; do not refactor opportunistically.
3. Verify (`npm run test-only` + lint) for each changed area.
4. Stop when findings are addressed — do not hunt for more once the budget is spent.
5. Reconcile via `reconcile-audit-issues.sh` so the audit issue tracker stays accurate.
6. Ensure disk space before setup on the self-hosted runner ([[kos-runner-disk-hygiene]]).

## Failure modes to avoid

- **Disk exhaustion** → ensure-disk-space before install; the run dies mid-setup otherwise.
- **Over-broad fixes** → a "code smell" becomes a refactor; keep each fix to the finding.
- **No verify** → unverified audit fixes regress; always run the real check.
- **Unreconciled issues** → audit issues pile up; run reconcile each cycle.
- **Concurrency cancellation** → mostly a newer run superseding this one — confirm before treating as failure (see [[kos-run-log-mining]]).

## Process Flow (Authoritative)

1. ensure-disk-space (self-hosted runner).
2. audit → concrete findings list.
3. minimal fix per finding.
4. verify per change (test + lint).
5. stop when addressed (budget-aware).
6. reconcile-audit-issues.
7. commit-and-push / report per workflow.

## Output Format

```
FINDINGS: n (debt=a smells=b tests=c)
FIXED: <file:line per fix>  DIFF=<files>
VERIFY: lint=ok test=ok
RECONCILE: applied
DISK: ensured
```

## Critical Constraints

- Never ship an audit fix without verification.
- Never let a "smell" fix become a cross-module refactor — split it out.
- Ensure disk before setup; reconcile issues after fixes.
- A cancelled audit-fix run is usually concurrency supersession, not a bug — verify before re-dispatch.
