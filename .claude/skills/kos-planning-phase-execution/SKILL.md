---
name: kos-planning-phase-execution
description: Keep .planning artifacts in sync and execute planned phases wave-by-wave — the shared discipline of gsd-planning (refresh phase artifacts) and gsd-planning-execute (wave-based execution), including intake collection and repair.
user-invocable: true
when_to_use: "When refreshing planning artifacts for a phase (gsd-planning) or executing a phase by waves (gsd-planning-execute), or when intake is missing/broken."
category: utilities
argument-hint: "[phase or wave]"
keywords: [planning, phase, wave, execute, intake, gsd, plan-phase, execute-phase]
related: [kos-gh-automation-tooling, kos-claude-turn-budget, kos-zai-run-failure-prevention]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from gsd-planning.yml (/gsd:plan-phase) + gsd-planning-execute.yml (--wave N --no-transition) prompts + intake scripts
  license: repo
  version: "1.0"
---

# Idea

Two workflows serve `.planning/`: `gsd-planning` (`/gsd:plan-phase` — refresh artifacts for a phase) and `gsd-planning-execute` (`/gsd:execute-phase 999 --wave N --no-transition` — run a phase wave-by-wave, no auto-transition). Both depend on correct **intake** (the wave/phase inputs). When intake is missing or malformed the run stalls; the repo ships `collect-gsd-planning-intake.cjs` and `repair-planning-intake.cjs` (+ `planning-intake-repair.yml`) precisely to fix that. The skill is: validate intake first, then refresh/execute within budget.

## When to invoke this skill directly

- You are refreshing a phase's planning artifacts.
- You are executing a phase wave.
- Intake is empty/broken and the run cannot proceed.

## References

- `gsd-planning.yml` (`/gsd:plan-phase`), `gsd-planning-execute.yml` (`--wave N --no-transition`).
- `.github/workflows/scripts/collect-gsd-planning-intake.cjs` — gather intake.
- `.github/workflows/scripts/repair-planning-intake.cjs` + `planning-intake-repair.yml` — repair intake.
- `.planning/` structure: PROJECT, ROADMAP, REQUIREMENTS, phase PLAN.md/SPEC.md.

## Communication Style

State phase + wave + intake status, then what was refreshed/executed. Cite the artifact paths touched.

## Core Principles

YAGNI / KISS / DRY. Validate intake before acting. Refresh only stale artifacts. Execute one wave, report, stop (`--no-transition` means do not auto-advance).

## Your Approach

1. Resolve the phase (and wave) from intake.
2. If intake is empty/malformed → run `repair-planning-intake` before proceeding.
3. Refresh (plan-phase): update the phase's PLAN/SPEC to match current code/requirements only where stale.
4. Execute (execute-phase): run the wave's tasks; do not transition to the next phase automatically.
5. Report artifacts touched / tasks done; stay in turn budget.

## Failure modes to avoid

- **Stalled on empty intake** → repair intake first; don't burn turns guessing the wave.
- **Auto-transitioning** → `--no-transition` is intentional for the scheduled runner; respect it.
- **Over-refreshing** → rewriting PLAN/SPEC that already match reality (noise).
- **Cross-phase scope creep** → execute only this wave's tasks.

## Process Flow (Authoritative)

1. Read intake (collect-gsd-planning-intake); repair if malformed.
2. Resolve phase + wave.
3. plan-phase: patch stale artifacts only.
4. execute-phase: run wave tasks; verify; no transition.
5. Report paths + task status.

## Output Format

```
PHASE=<id> WAVE=<n> INTAKE=<ok|repaired>
REFRESHED: <plan.md, spec.md, ...>
EXECUTED: <task list with status>
TRANSITION: none (--no-transition)
```

## Critical Constraints

- Never auto-advance phases under `--no-transition`.
- Never execute without valid intake — repair first.
- Keep planning edits consistent across PROJECT/ROADMAP/REQUIREMENTS/phase docs (no orphan claims).
