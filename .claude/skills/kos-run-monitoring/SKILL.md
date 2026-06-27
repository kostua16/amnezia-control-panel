---
name: kos-run-monitoring
description: Monitor recent GitHub Actions runs for this repo, detect failures, diagnose root cause, and report — the monitor-amnezia-control-panel-github-runs discipline (reliable when it stays scoped and uses the analyzer).
user-invocable: true
when_to_use: "When the monitor-amnezia-control-panel-github-runs workflow surveys recent runs, or when standing up/repairing its diagnose-then-report flow."
category: utilities
argument-hint: "[window or workflow]"
keywords: [monitor, runs, github-actions, detect, diagnose, report, failure]
related: [kos-run-log-mining, kos-zai-run-failure-prevention, kos-gh-automation-tooling, kos-claude-turn-budget]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from monitor-amnezia-control-panel-github-runs.yml (/gsd:debug, monitor-runs/report-failure) + 30/30 success runs
  license: repo
  version: "1.0"
---

# Idea

`monitor-amnezia-control-panel-github-runs` watches recent runs across the repo's workflows, detects failures, and `/gsd:debug`s them to a root cause, then reports. It is the most reliable workflow in the set (30/30 success) precisely because it stays scoped: roll up → pick failures → diagnose each with the analyzer → report — no fixing here. The skill preserves that discipline so it keeps succeeding: monitor and diagnose, hand off the fix.

## When to invoke this skill directly

- You are running the run-monitor survey.
- You need to detect + diagnose a batch of recent failures.

## References

- `monitor-amnezia-control-panel-github-runs.yml` (`/gsd:debug`, monitor-runs + report-failure).
- `.github/workflows/scripts/analyze-claude-runs.sh` + `scan-claude-logs.cjs`.
- [[kos-run-log-mining]] — the layered diagnosis this workflow relies on.
- `report-failure` action (mode: issue).

## Communication Style

Rollup → failed runs with their dominant mode + evidence → which need a fix vs. which are transient.

## Core Principles

YAGNI / KISS / DRY. Monitor + diagnose only; do not fix here (that's the owning workflow's job). Reuse analyze-claude-runs. Transient (rate-limit/cancel) ≠ actionable.

## Your Approach

1. **Survey:** recent runs across workflows (conclusion rollup).
2. **Detect:** the non-success runs; classify each (failure vs. cancel vs. skip).
3. **Diagnose:** for each real failure, the dominant mode + evidence ([[kos-run-log-mining]]).
4. **Triage:** transient (rate-limited/cancelled-by-supersession) → note, no action; structural → report for the owning workflow to fix.
5. **Report:** file/refresh failure issues for structural failures only.

## Failure modes to avoid

- **Fixing in the monitor** → out of scope; monitor diagnoses, owning workflow fixes.
- **Treating cancel/skip as failure** → cancel ≈ supersession; skip ≈ trust gate; neither is actionable here.
- **Re-reading full logs** → use analyze-claude-runs + `--log-failed` grep.

## Process Flow (Authoritative)

1. survey recent runs (rollup).
2. detect non-success; classify.
3. diagnose each real failure (dominant mode + evidence).
4. triage transient vs. structural.
5. report structural failures; note transient.

## Output Format

```
SURVEY: <n> runs across <m> workflows
FAILURES: #<id> <wf> => <mode> (<evidence>)  [structural|transient]
ACTION: report=<ids>  note=<ids>
```

## Critical Constraints

- Never fix from the monitor; diagnose + report only.
- Never report a transient (rate-limit / concurrency-cancel / trust-skip) as a failure.
- Always cite run id + evidence line for each diagnosed failure.
