---
name: kos-improvement-ideation
description: Produce concrete, repo-specific improvement suggestions (and JSON follow-ups) — the shared discipline of suggest-improvements (architectural review) and pr-improve (PR follow-ups), avoiding generic advice and turn-budget failures.
user-invocable: true
when_to_use: "When suggest-improvements runs a deep architectural review, or pr-improve analyzes a PR for follow-ups, or when such a run failed on turn-limit / produced generic output."
category: utilities
argument-hint: "[scope or pr-number]"
keywords: [improvements, suggest, ideation, roadmap, architecture, follow-up, json]
related: [kos-claude-turn-budget, kos-gh-automation-tooling, kos-zai-run-failure-prevention]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from suggest-improvements.yml (/gsd:explore) + pr-improve.yml (/gsd:quick, JSON suggestions) prompts + turn-limit failures
  license: repo
  version: "1.0"
---

# Idea

`suggest-improvements` (`/gsd:explore` — deep architectural review → 2–3 concrete follow-ups) and `pr-improve` (`/gsd:quick` — analyze a PR for follow-ups, **JSON only**, **do not push**) share one job: turn observations into *concrete, repo-specific* suggestions. Runs fail two ways: (1) turn-budget blowout (the pr-improve prompt even embeds the ≤6/≤20/≤6 allocation), and (2) generic advice ("add more tests", "improve error handling") that is useless as a follow-up. The skill forces specificity and budget discipline, and the right output shape per workflow.

## When to invoke this skill directly

- You are producing architectural/PR improvement suggestions.
- A suggest-improvements/pr-improve run hit turn_limit or returned vague output.

## References

- `suggest-improvements.yml` (`/gsd:explore`, record 2–3 concrete follow-ups).
- `pr-improve.yml` (`/gsd:quick`, JSON-only suggestions, do NOT push commits, turn allocation).
- `build-automation-pr-body.cjs` / `collect-targets` step — downstream consumers of the suggestions.
- [[kos-claude-turn-budget]] — the allocation pr-improve embeds.

## Communication Style

Each suggestion: one problem (cited file:line) + one concrete change + expected benefit. No prose advice. pr-improve → JSON.

## Core Principles

YAGNI / KISS / DRY. Concrete > comprehensive. 2–3 sharp beats 10 vague. Cite the code. pr-improve never pushes.

## What "concrete and repo-specific" means

- ❌ "Improve test coverage" → ✅ "`src/lib/x.ts`'s `parse()` has no tests for empty input; add 2 cases."
- ❌ "Better error handling" → ✅ "`api/route.ts:42` swallows the error; rethrow so the caller logs it."
- Every suggestion must name a file/symbol and a specific change.

## Your Approach

1. Scope: architectural scan (suggest-improvements) or one PR diff (pr-improve).
2. Within the investigate-phase budget, find 2–3 highest-value, code-cited observations.
3. Express each as problem → concrete change → benefit.
4. suggest-improvements: record as follow-ups (capture/roadmap seeds).
5. pr-improve: emit JSON suggestions only; do not edit or push.

## Failure modes to avoid

- **Turn blowout** → over-scanning the whole repo; cap investigation, deliver 2–3.
- **Generic output** → no file/symbol = useless; reject your own suggestion if it lacks a citation.
- **Pushing from pr-improve** → explicitly forbidden; suggestions only.
- **Wrong output shape** → pr-improve must be JSON (its consumer parses it).

## Process Flow (Authoritative)

1. Investigate (budget-capped) → candidate observations.
2. Filter to 2–3 concrete, cited ones.
3. Format per workflow (follow-ups / JSON).
4. Deliver; do not push (pr-improve).

## Output Format

suggest-improvements:
```
FOLLOW-UPS (2-3):
- <file:line> <problem> => <change> (benefit)
```
pr-improve (JSON):
```json
[{"file":"...","problem":"...","suggestion":"...","benefit":"..."}]
```

## Critical Constraints

- Never ship a suggestion without a file/symbol citation.
- pr-improve: JSON only, never edit/push.
- Respect the turn allocation; deliver fewer-but-concrete over many-but-vague.
