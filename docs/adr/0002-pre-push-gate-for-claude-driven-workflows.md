# ADR 0002: Pre-push gate for claude-driven workflows

- **Date:** 2026-06-23
- **Status:** Accepted

## Context

The claude-driven workflows (`run-zai`/`claude-code-action`) create an untracked
`.claude-pr/` directory in the runner workspace — a parallel copy of `.claude/` and
`get-shit-done/` so the agent runs with PR-scoped config. It is not in the repo,
not relocatable (no working-dir knob in `run-claude-params`), and was not covered by
eslint's `globalIgnores` (only `.claude/**` was).

On PR #472 this bit `fix-review`: `npm run lint` (`eslint .`) inside `npm run test`
walked `.claude-pr/**/*.cjs` and tripped `@typescript-eslint/no-require-imports`,
failing the gate. The gate step ran with `continue-on-error: true`, so the Actions
UI showed it green (`conclusion: success`) while `steps.validate.outcome` was
`failure`. The push step (`if: ... validate.outcome == 'success'`) was silently
skipped, and the summary comment rendered the **agent's self-reported** validation
(all "pass") under a "Validation failed — fixes not pushed" header — a flat
contradiction, with no way for the maintainer to tell what actually failed.

Two independent flaws:
1. **Gate fragility** — the gate linted a runtime artifact it should never see.
2. **Misleading reporting** — the verdict was masked by `continue-on-error`, and the
   comment trusted the agent's self-report instead of the real gate outcome.

Separately, of the 18 `run-zai` workflows, **6 push lintable code**: only `fix-review`
and `workflow-health-optimize` had an enforced gate; the other 4 (`fix-issue`,
`audit-fix`, `_auto-fix-ci`, `monitor-amnezia-control-panel-github-runs`) only *asked*
the agent in the prompt to run lint/types, then pushed whatever it produced.

## Decision

Adopt a single shared pre-push gate (`.github/actions/validate-pr-gate`) plus a shared
dual-block summary renderer, and apply them across all 6 code-pushing claude-driven
workflows. Lock the following design decisions (each with its rationale):

### D1 — Lint defense: globalIgnores **plus** tracked-file lint

- Add `.claude-pr/**` to eslint `globalIgnores` (and `.gitignore`), matching the
  existing convention for `.claude/**`, `.codex/**`, `.agents/**`. This alone fixes
  `eslint .` and `next build`'s lint pass.
- The gate action additionally lints **git-tracked files only**
  (`git ls-files … | xargs -0 npx eslint`).

**Why both:** globalIgnores is the targeted fix; tracked-file lint makes the gate
correct **regardless of `.claude-pr/`'s contents** (it could, in principle, be a
workdir) and lints exactly what we are about to push. "Lint what we push" is the
semantically right gate, immune to any future runtime artifact.

### D2 — Gate scope: `build` is opt-out via `run-build`

The gate runs lint + unit tests + workflow script e2e-tests + prisma-safe-sql
**always** (fast, universally load-bearing). `npm run build` is behind a `run-build`
input (default `true`).

**Why:** `build` is CI-matching where the workflow edits src, but `workflow-health-optimize`
edits **YAML only** — there `build` adds no value and the script e2e-tests are the real
invariant, so it passes `run-build: 'false'`. Keeping the four fast checks always-on and
`build` opt-out avoids both false confidence (skipping `build` on src edits) and wasted
time (forcing `build` on YAML edits).

### D3 — Gate-skip on no-op: fix-review only

Only `fix-review` checks out an **existing** PR head, so `HEAD == head_sha` is a clean,
well-defined change check (it even survives an agent that committed despite
instructions). The other 5 create **new** automation branches (no head to diff) and
already handle no-op via `commit-and-push` returning `pushed=false`. Post-D1 the gate
no longer spuriously fails on a no-op anyway, so the added complexity was not justified
there.

### D4 — Enforced gate on all 6 siblings

Every code-pushing claude-driven workflow now gates its push on the explicit
`gate_passed` output. This replaces "the prompt asks the agent to self-police" with an
enforced invariant: non-green agent work is not pushed. (Doc/triage `run-zai` workflows
like `gsd-planning-execute` are intentionally excluded — they push docs/planning only,
no lintable src.)

### D5 — Dual-block summary; gate alone drives the verdict

The summary renders **two** labelled blocks: the agent's self-reported validation
("may be inaccurate") beside the workflow gate's real per-check outcomes
("authoritative"), behind a banner stating only the gate decides a push. The push
verdict keys **only** off the gate outcome, never the agent self-report.

**Why:** showing both turns the PR #472 contradiction into a *visible delta* (agent said
pass, gate said fail) instead of a flat contradiction, while preserving the agent's
report for transparency.

## Consequences

**Positive**
- The `.claude-pr/` runtime artifact can never again crash a gate; the gate is correct
  no matter what untracked state the runner accumulates.
- Gate failures are **visible** (per-check outcomes, red step in the UI, accurate
  summary) instead of masked green; no more "all-pass under validation-failed".
- All 6 code-pushing workflows uniformly refuse to push non-green work — CI rejections
  of automation PRs should drop.
- `fix-review` no-ops (no review findings) post a clean "No changes needed" instead of
  tripping the gate.

**Negative / trade-offs**
- The gate adds one full validation pass (incl. `build` for src-editing workflows) to
  each run; `_auto-fix-ci` runs in a loop, so each iteration pays it. Accepted — it
  edits src, so CI-matching is the point. If loop latency bites, it can opt out of
  `build` later.
- The 4 previously-ungated siblings are a **behavior change**: agent work that does not
  pass the gate is now rejected (no PR). This is intended hardening, matching what the
  prompts already asked for.
- For the 4 siblings, a gate failure lands in their existing "not pushed" path; the
  posted message may read as "no changes" rather than "gate failed". Acceptable
  terminal (no PR created); per-sibling gate-failed wording is a future polish.
- Relies on `run-zai`'s `claude_changed_files_list` being git-derived (it is) for the
  no-op skip on the 4 siblings.

## Alternatives considered

- **Relocate `.claude-pr/`** out of the workspace — rejected: `run-claude-params`
  exposes no working-dir/config-dir knob; it is created by the external action.
- **Ignore `.claude-pr/` only (no tracked-file lint)** — rejected as the sole defense:
  it depends on enumerating runtime dir names and does not address the "could be a
  workdir" concern.
- **Full gate for all 6 with no `run-build` opt-out** — rejected: forces a pointless
  `build` on `workflow-health-optimize`'s YAML-only edits.
- **Trust the agent self-report for gating** — rejected: it was the direct cause of the
  PR #472 contradiction (the agent reported all-pass while the gate failed).

## References

- [ADR 0001](0001-e2e-characterization-suite-as-workflow-gate.md) — e2e characterization
  suite as the workflow-change gate (this change follows its protocol).
- `.github/actions/validate-pr-gate/action.yml` — the shared gate action.
- `.github/workflows/scripts/lib/gate-summary.cjs` — the dual-block renderer.
- Incident: PR #472 comment
  [#issuecomment-4771328260](https://github.com/kostua16/amnezia-control-panel/pull/472#issuecomment-4771328260).
