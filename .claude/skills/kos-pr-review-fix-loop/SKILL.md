---
name: kos-pr-review-fix-loop
description: Resolve the actionable review findings on a PR (fix-review / code-review workflows) by collecting feedback, fixing only actionable items, and pushing correctly — without the commit-and-push failure mode.
user-invocable: true
when_to_use: "When a run must address review findings on a PR (fix-review), or perform a combined code review (code-review), or when such a run failed at commit-and-push / wake-orchestrator."
category: utilities
argument-hint: "[pr-number]"
keywords: [review, fix-review, code-review, findings, pr, commit-and-push, actionable]
related: [kos-commit-and-push-branch, kos-claude-turn-budget, kos-zai-run-failure-prevention, kos-gh-automation-tooling]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from fix-review.yml / code-review.yml prompts + commit-and-push & wake-orchestrator failures
  license: repo
  version: "1.0"
---

# Idea

Two PR-focused workflows share a loop: `fix-review` (`/gsd:debug` — "Fix the actionable review findings on this PR") and `code-review` (`/gsd:code-review` — combined review of a PR). Observed failures: fix-review dies at the **commit-and-push** step; code-review dies at **wake-orchestrator**. Both also waste runs by over-fixing (touching non-actionable nits) or under-scoping. This skill is the disciplined loop: gather findings → fix only actionable → push correctly → wake orchestrator safely.

## When to invoke this skill directly

- You are fixing review findings on a PR or running a combined review.
- A fix-review/code-review run failed at commit-and-push or wake-orchestrator.

## References

- `fix-review.yml`, `code-review.yml` prompts.
- `.github/workflows/scripts/collect-review-feedback.cjs` / `collect-stale-pr-feedback.cjs` — gather findings.
- `evaluate-fix-review-eligibility.cjs` — whether a fix-review should run.
- `commit-and-push` action (the recurring failure point) — see [[kos-commit-and-push-branch]].
- `wake-orchestrator` step / `orchestrate-pr-flow.cjs`.

## Communication Style

List actionable findings as a checkbox set, fix each, then one push. Cite the review comment per fix.

## Core Principles

YAGNI / KISS / DRY. Fix only what a reviewer flagged as actionable; skip style nits the linter owns. One push at the end, after `setup-bot-git`.

## The loop

1. **Collect** all open review findings (collect-review-feedback) — inline comments, review bodies, stale threads.
2. **Triage** each: actionable (correctness/bug/missing test) vs. noise (preference/linter). Fix actionable; document skipped.
3. **Fix** each actionable item minimally; run lint/typecheck per change.
4. **Push** once via `commit-and-push` (identity set; real diff only; `GH_PAT`).
5. **Wake orchestrator** only after push succeeds; tolerate its non-zero exit where auth was pre-verified (the workflows already comment "tolerate non-zero exit").

## Failure modes to avoid

- **commit-and-push failure** → empty diff (guard with `git diff`), missing bot identity (run `setup-bot-git`), or 403 (use `GH_PAT`).
- **wake-orchestrator failure** → often a tolerated non-zero exit from pre-auth; confirm it is not a real orchestration error before treating the run as failed.
- **Over-fixing** → touching files/lines no reviewer flagged (scope creep, bigger diff, slower review).
- **Turn blowout** → batch fixes; one verify run.

## Your Approach

1. Pull findings; triage to actionable.
2. Fix minimally; verify each.
3. Push once correctly.
4. Wake orchestrator; classify its exit correctly.

## Process Flow (Authoritative)

1. collect-review-feedback → list findings.
2. Mark each actionable/noise.
3. Implement fixes (turn-budget aware).
4. `npm run lint` + `npm run test-only` for changed area.
5. commit-and-push (identity + PAT + diff-guard).
6. wake-orchestrator (tolerate pre-auth non-zero exit).

## Output Format

```
FINDINGS: n actionable / m skipped
FIXES: <file:line per fix>
VERIFY: lint=ok test=ok
PUSH: <branch> (<n> files)
```

## Critical Constraints

- Never push without a real diff; never push without bot identity.
- Never "fix" nits the linter/formatter owns — run prettier-auto-fix instead.
- Do not treat a tolerated wake-orchestrator non-zero exit as a hard failure without checking `orchestrate-pr-flow.cjs` output.
