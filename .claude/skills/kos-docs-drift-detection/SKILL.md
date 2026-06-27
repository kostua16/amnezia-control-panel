---
name: kos-docs-drift-detection
description: Detect documentation drift between the implementation and .planning/ + docs/ artifacts and update ONLY documentation files to reflect reality — the docs-drift workflow's discipline, including its soft-failure and prettier-on-docs pitfalls.
user-invocable: true
when_to_use: "When the docs-drift workflow runs (review codebase vs .planning/docs), or when such a run soft-failed."
category: utilities
argument-hint: "[scope or doc-file]"
keywords: [docs, drift, documentation, planning, docs-update, prettier]
related: [kos-zai-run-failure-prevention, kos-claude-turn-budget, kos-gh-automation-tooling]
metadata:
  author: kos-workflow-improvement
  attribution: distilled from docs-drift.yml prompt + soft-failure runs (claude soft failure)
  license: repo
  version: "1.0"
---

# Idea

`docs-drift` compares the implementation against `.planning/` artifacts and standard docs (`docs/*.md`), then updates **only documentation files** to match reality. Runs are brittle (2 fail / 2 cancel / 1 success in the sample), failing as a "Claude soft failure: claude-code-action step failed." Two pitfalls drive that: (1) drifting into editing *code* instead of docs (scope violation → churn), and (2) running whole-file `prettier --write` on docs, which rewrites every table into a huge noisy diff. The skill keeps the run scoped to docs and format-safe.

## When to invoke this skill directly

- You are running the docs-drift check.
- A docs-drift run soft-failed and you are diagnosing/rescoping.

## References

- `docs-drift.yml` prompt (`/gsd:docs-update`, review vs `.planning/` + standard docs, update only docs).
- `.planning/` (PROJECT, ROADMAP, REQUIREMENTS, phase docs) + `docs/` (code-standards, system-architecture, changelog, roadmap).
- `prettier-auto-fix` action + repo fact: CI `format:check` is src-only; whole-file prettier on docs pads every table (noisy) — do NOT whole-file prettier docs.

## Communication Style

List drift items as doc-file → what changed in code → the doc fix. State explicitly: code untouched.

## Core Principles

YAGNI / KISS / DRY. Update docs to match code, never code to match docs (that's a different workflow). Minimum diff per doc. No whole-file prettier on docs.

## Your Approach

1. Survey what changed in code recently (recent commits / current branch) vs what `.planning/`+`docs/` claim.
2. For each mismatch, edit **only the doc** to reflect reality.
3. Keep edits minimal (a sentence/table row), not a rewrite.
4. Do not run whole-file prettier on docs; if formatting is needed, scope it to the lines you touched.
5. Summarize drift fixed; if none, exit cleanly (no doc = success-with-no-changes).

## Failure modes to avoid

- **Soft failure** → usually scope/turn blowout or a wrapper hiccup; read `claude_soft_success_reason` before retry; rescope, don't blindly re-run.
- **Editing code** → out of scope; this workflow only edits docs.
- **Whole-file prettier on docs** → massive table-padding diff; CI format check is src-only so it is unnecessary anyway.
- **Rewriting docs wholesale** → review-blocking noise; patch the stale fact only.

## Process Flow (Authoritative)

1. diff recent code reality vs `.planning/` + `docs/`.
2. enumerate drift items.
3. edit only docs, minimal patches.
4. no whole-file prettier on docs.
5. summary or clean no-op exit.

## Output Format

```
DRIFT: n items
- <doc-file>: <code reality> => <doc fix>
CODE CHANGES: none (docs-only workflow)
```

## Critical Constraints

- Never edit code in this workflow; docs only.
- Never whole-file `prettier --write` on `docs/*.md`.
- A no-drift run is a clean success, not a failure — guard against "must change something" bias.
