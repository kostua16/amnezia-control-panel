---
name: kos-claude-turn-budget
description: Stay inside the MAX_TURNS budget of a zai/Claude workflow run by phasing work (investigate/implement/verify) and cutting re-reads, so runs do not hit turn_limit_hit or zero_turns.
user-invocable: true
when_to_use: "Any task running inside a run-zai workflow with a turn limit, or when a run failed with turn_limit_hit / produced no output."
category: utilities
argument-hint: "[task and max-turns]"
keywords: [turns, max-turns, budget, turn-limit, scope, efficiency]
related: [kos-zai-run-failure-prevention, kos-gh-automation-tooling]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from pr-improve / suggest-improvements prompt allocations + run failures
  license: repo
  version: "1.0"
---

# Idea

Every zai workflow pins `MAX_TURNS` (commonly 50–100; targeted PR tasks as low as 32). Hitting the ceiling with `is_error` is a classified hard failure (`turn_limit_hit`); using zero turns is `zero_turns`. Both waste a run. The fix is **phased budgeting**: decide up front how many turns investigation, implementation, and verification each get, and never re-derive context you already hold.

## When to invoke this skill directly

- Your task is running inside a workflow run and you know the turn ceiling.
- A run failed `turn_limit_hit` and you are re-scoping before re-dispatch.
- You are writing/editing a workflow prompt and need to embed a budget allocation.

## References

- `run-zai` outputs: `claude_num_turns`, `claude_turns_budget_pct`, `max_turns` input.
- `scan-claude-logs.cjs` → `turn_limit_hit`, `zero_turns` categories.
- The pr-improve prompt embeds the canonical allocation (≤6 investigate / ≤20 implement / ≤6 verify for a 32-turn task) — reuse it.

## Communication Style

State the ceiling, then the phase allocation as three numbers that sum under it. One line.

## Core Principles

YAGNI / KISS / DRY. Do not read a file twice — cache it in context. Do not investigate broadly when the task is narrow. Verification is the first thing to cut, not the last.

## Your Expertise

A turn = one model step that may call many tools. Cost is dominated by *re-reading* files already in context and *exploring* outside the task scope. The highest-leverage discipline is: read the minimal set once, edit, then verify with a single command.

## The phased budget (per ~32-turn targeted task; scale linearly)

| Phase | Budget | Allowed actions | Stop when |
|---|---|---|---|
| Investigate | ≤6 turns | read logs, grep, reproduce, locate code | root cause + target file identified |
| Implement | ≤20 turns | edit files, run fixes, iterate | change compiles/lints |
| Verify | ≤6 turns | run tests/lint, confirm the fix | green (or known-failing documented) |

For 50-turn runs multiply ~1.5x; for 100-turn exploratory runs allow more investigation but still cap verify.

## Your Approach

1. Read the ceiling from the workflow env (`MAX_TURNS`) or prompt.
2. Before the first tool call, state the phase allocation in your plan.
3. During investigation, stop the moment you have a concrete root cause + file:line — do not "understand the whole module."
4. During implementation, batch edits; run one compile/lint, not one per edit.
5. Reserve the verify phase; if you are over budget, cut scope, not verification of what you changed.

## Process Flow (Authoritative)

1. **Declare** the ceiling and the three phase numbers.
2. **Investigate** to a root cause, not to comprehension.
3. **Implement** the smallest change that fixes it.
4. **Verify** with the repo's real check (`npm run test-only` + lint), never a mock.
5. If over budget at the phase boundary: narrow scope and continue — do not silently exceed.

## Anti-patterns seen in failed runs

- Re-reading the same file each turn (use what is in context).
- Exploring unrelated modules "for completeness".
- Running `npm install` / heavy builds mid-investigation (defer to verify).
- Spending the whole budget investigating and leaving zero for the fix (→ `turn_limit_hit`).
- Producing no tool calls at all (→ `zero_turns`) because the gate/prompt was mis-scoped.

## Output Format

Plan line: `CEILING=N  inv/impl/verify = a/b/c (a+b+c < N)`. On finish: `TURNS_USED=x/N  PHASE=verify`.

## Critical Constraints

- Never exceed the ceiling silently; if you will, narrow scope and say so.
- Never fake verification (no mocks/cheats to "pass") — per repo dev rules.
- If the task genuinely needs more than the ceiling, say so in the result rather than burning the run.
