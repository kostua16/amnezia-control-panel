# ADR 0001: E2E characterization suite as the workflow-change gate

- **Date:** 2026-06-17
- **Status:** Accepted

## Context

The GH-workflows architecture review (`docs/gh-workflows-architecture-review.md`) proposed P0 fixes — path-filtering `ci.yml`, an auto-fix attempt cap, scheduled-fleet gating, a `fix-review` split — that could **silently break load-bearing automation flows**: the merge gate (`pr-finalizer`), the auto-fix loop (`fix-*`), and the AI-review label contract. The decision logic behind these flows (`evaluate-pr-finalizer-decision.cjs`, `required-check-evidence.cjs`, `orchestrate-pr-flow.cjs`, …) had **no tests**.

Characterizing `getRequiredCheckStatus` (`required-check-evidence.cjs:63-100`) made the risk concrete: a skipped/cancelled required check lands in the `cancel` bucket, which the aggregator counts as **`failing`**. So a single path-filtered or skipped required job blocks the entire PR (catalog cases M11/M12). This was invisible precisely because nothing exercised the path. Fixing blind would risk wedging merges or looping the auto-fixer.

## Decision

Adopt a **characterization-first e2e suite** as the gate for every workflow change.

1. **Catalog is the spec** — `docs/workflow-e2e-scenarios.md` describes every flow as `trigger → terminal` (`merged` / `closed` / `no-op`).
2. **Characterization tests lock CURRENT behavior** (active `test()`, green) — the regression net. They make no correctness judgment.
3. **Spec tests name desired fixes** and ship as `test.todo` / `test.skip` — visible and tracked, but CI-green. They are **never silently deleted**; each is activated (`test()`) and implemented in its fix PR.
4. **Gate** — any change to `.github/workflows/**`, `.github/actions/**`, `.github/workflows/scripts/**`, `policy.json`, or `pr-flow.json` must keep the active suite green and update the catalog when behavior changes (see `docs/code-standards.md` → "Workflow change protocol").
5. **Land the net first** (Phase 1, zero production change), then implement each fix (Phase 2) as its own PR — activate the spec, implement until green, full suite stays green.
6. **Hybrid terminal model** — tests assert the *terminal decision* the scripts emit; out-of-script completion (GitHub auto-merge, human merge, `stale.yml` close) is covered by narrow targeted tests, not end-to-end API mocks.

## Consequences

**Positive**
- Regressions in flow logic are caught before merge; the previously-untested merge gate becomes protected.
- Fixes are test-driven: the red `todo` states the intent, the implementation turns it green, the regression net guarantees no collateral breakage.
- The catalog is a durable, reviewable map of system behavior; future contributors see the flows without reading every YAML.

**Negative**
- Upfront cost: authoring the suite (~6 test files + a thin `e2e-simulator.cjs`).
- Spec tests live as `todo`/`skip` until their fix ships — discipline is required so they aren't dropped (the rule calls this out).
- Out-of-script terminals are not asserted end-to-end; a GitHub-side regression (e.g. auto-merge behavior change) wouldn't be caught by this suite — mitigated by the narrow targeted tests.

## Alternatives considered

- **Fix-first, test-later:** rejected — the very reason flows are at risk is the absence of tests; fixing first repeats the trap.
- **End-to-end workflow execution tests (act/gha-run):** rejected — slow, brittle, require GitHub API/mocking; the decision scripts are pure functions over fixtures, which is faster and sufficient for correctness.
