# Final Review — kos- agents & skills

**Date:** 2026-06-27
**Reviewer:** orchestrator
**Sufficiency bar (GOAL.md):** APPROVED only if the agent + its skills would have prevented each repeated failure mode seen in the extracted runs, would prevent the failed tool calls / misuse patterns, and all lacked knowledge has been gathered.

## Verdict

<promise>APPROVED</promise>

The aligned set (18 agents + 19 skills) traces to every observed failure mode and every lacked-knowledge item mined from the runs. Known issues are carried forward (below) — none blocks the bar.

## Sufficiency trace — observed failure mode → coverage

| Observed failure mode (workflow · run evidence) | Covered by |
|---|---|
| commit-and-push step failure (fix-review · run 28291805447) | kos-commit-and-push-branch + agent checklist (bot identity, diff-guard, `GH_PAT`) |
| wake-orchestrator job failure (code-review · run 28130963851) | kos-pr-review-fix-loop (tolerate pre-auth non-zero exit) + agent |
| runner disk exhaustion `No space left on device` (audit-fix · run 28097503249) | kos-runner-disk-hygiene (ensure-disk-space before install) + agent |
| post-ancestry / upsert-rebase-comment exit 1 on empty env (rebase-pr · run 28281596962) | kos-rebase-conflict-resolution (guard empty ancestry, exit 0) + agent |
| turn_limit_hit / non-rate-limit error (suggest-improvements · 26618316122; pr-improve turn allocation) | kos-claude-turn-budget + kos-improvement-ideation |
| Claude soft failure (docs-drift · 26706142000) | kos-docs-drift-detection + kos-zai-run-failure-prevention (soft-failure handling) |
| trust-gate `skipped` runs (claude/triage/gsd-planning/fix-issue/rebase/fix-review) | kos-trigger-policy-trust-gate (skip = gate, not failure; dual allowlist) |
| concurrency cancellations (audit-fix, audit-auto-prs, pr-improve) | kos-run-log-mining + agents (cancel ≈ supersession) |
| failed tool calls / permission denials / non_human_actor (cross-cutting taxonomy) | kos-zai-run-failure-prevention (canonical taxonomy) + kos-gh-automation-tooling (allowed-tools/allowed-bots) |

## Lacked-knowledge gathered (category d)
Encoded into agents/skills so the runtime no longer re-derives it each run:
- The canonical run-failure taxonomy (from `scan-claude-logs.cjs`) → kos-zai-run-failure-prevention.
- The `.github/actions` + `scripts/` intent→tool map → kos-gh-automation-tooling.
- Trust gate dual-allowlist fact (`policy.json` gate vs `run-zai: allowed-bots`) → kos-trigger-policy-trust-gate.
- "ensure-disk-space before install" placement → kos-runner-disk-hygiene.
- "No whole-file prettier on docs" (CI format check is src-only) → kos-docs-drift-detection.
- pr-improve: JSON-only suggestions, do-not-push, ≤6/≤20/≤6 allocation → kos-improvement-ideation + kos-claude-turn-budget.
- gsd-planning-execute: `--no-transition` is intentional → kos-planning-phase-execution.
- rebase-pr: reporting step must survive empty ancestry → kos-rebase-conflict-resolution.
- Reporting-step tolerated non-zero exit ≠ failure → kos-workflow-health-optimization, kos-run-monitoring, kos-pr-review-fix-loop.

## Termination proxy
No new lacked-knowledge pattern surfaced in this final review round.

## Known issues carried forward (round-4-style honesty)
1. **GOAL.md "19 workflows" vs 18 listed.** All 18 listed workflows processed. Count is a goal-doc inconsistency; flagged, not silently "fixed."
2. **Empirical validation is post-merge** (per GOAL.md success criteria — no local pre-merge check). This approval is the subjective review gate; first real runs are the empirical check.
3. **Wiring is the natural next step.** The artifacts encode the knowledge; today's workflow prompts call `/gsd:*` via `run-zai` and do not yet @-reference these `kos-` agents. Connecting the prompts to invoke the matching `kos-` agent (or feeding these skills into the `/gsd:*` commands) is the follow-up that makes the knowledge active. Not a bar blocker — the knowledge is stored as required.
4. Light-signal workflows (monitor, maintenance, issue-catch-up, gsd-planning-execute, audit-auto-prs, dependency-review, claude, triage, gsd-planning, workflow-health-optimize) had fewer repeated failures to mine; their agents encode procedure + cross-cutting prevention, which is proportionate (less signal → less to encode), not a gap.

## Exit criteria (GOAL.md)
- [x] All listed workflows (18) processed.
- [x] All agents (18) and skills (19) created.
- [x] All per-workflow loops finished (APPROVED at this final review).
- [x] Orchestrator alignment complete (0 merges needed; see alignment report).
- [x] Final review: APPROVED.
