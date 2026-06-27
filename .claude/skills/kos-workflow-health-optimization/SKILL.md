---
name: kos-workflow-health-optimization
description: Collect workflow run health, optimize flaky/slow workflows, and report through the blocked-gate — the workflow-health-optimize discipline, without turning a tolerated reporting non-zero exit into a false failure.
user-invocable: true
when_to_use: "When the workflow-health-optimize workflow runs its scheduled collect→optimize→report cycle, or when a run failed at report-blocked-gate/report-failure."
category: utilities
argument-hint: "[workflow-name or 'all']"
keywords: [workflow-health, optimize, flaky, collect-runs, blocked-gate, health]
related: [kos-run-log-mining, kos-gh-automation-tooling, kos-zai-run-failure-prevention]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from workflow-health-optimize.yml (collect-runs/optimize/report-blocked-gate/report-failure) + run analysis scripts
  license: repo
  version: "1.0"
---

# Idea

`workflow-health-optimize` runs a scheduled collect→optimize→report loop over workflow runs: `collect-runs` gathers recent run health, `optimize` acts on flaky/slow/repeatedly-failing workflows, `report-blocked-gate` surfaces anything blocked, `report-failure` files on red. The run mostly succeeds (29/1). The skill is the diagnosis-then-act order: roll up health with the existing analyzer, optimize the real bottleneck (not a vibe), and report accurately — a reporting step's tolerated non-zero exit must not be misread as a workflow failure.

## When to invoke this skill directly

- You are running the health-optimize cycle.
- You are deciding which workflow to optimize and how.

## References

- `workflow-health-optimize.yml` (collect-runs, optimize, report-blocked-gate, report-failure).
- `.github/workflows/scripts/analyze-claude-runs.sh` + `scan-claude-logs.cjs` — health rollup.
- [[kos-run-log-mining]] — efficient diagnosis feeding optimization.
- `report-failure` action (mode: issue).

## Communication Style

Health rollup (per workflow: success/fail/cancel/median duration) → the one bottleneck → the one optimization → report status.

## Core Principles

YAGNI / KISS / DRY. Optimize the highest-impact bottleneck only. Reuse analyze-claude-runs; don't recompute. A reporting non-zero exit ≠ a failed optimization.

## Your Approach

1. **collect-runs:** roll up each workflow's recent conclusions + durations (analyze-claude-runs).
2. **optimize:** pick the workflow with the worst signal (most fails / slowest / flakiest); apply one targeted fix (allowlist, prompt scope, disk, timeout).
3. **report-blocked-gate:** list anything still blocked; do not mask it.
4. **report-failure:** only if the optimization itself failed — not because a reporting step exited non-zero.

## Failure modes to avoid

- **Misreading a reporting non-zero exit** → report-blocked-gate/report steps often tolerate non-zero (pre-auth); confirm the real outcome before filing failure.
- **Vibe optimization** → optimize without run evidence; always cite the rollup.
- **Over-optimizing** → touching many workflows at once (unattributable); one bottleneck per cycle.

## Process Flow (Authoritative)

1. collect-runs → health rollup per workflow.
2. rank → pick top bottleneck.
3. optimize → one targeted change, cited to the rollup.
4. report-blocked-gate (accurate).
5. report-failure only on a real optimization failure.

## Output Format

```
HEALTH: <wf>: s/f/c/dur  ...  => BOTTLENECK: <wf> (<reason>)
OPTIMIZE: <one change> (cited: <rollup evidence>)
BLOCKED: <none|list>
```

## Critical Constraints

- One optimization per cycle, cited to run evidence.
- Never file report-failure for a tolerated reporting-step non-zero exit.
- Never mask a blocked gate in report-blocked-gate — surface it.
