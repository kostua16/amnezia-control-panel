# Orchestrator Alignment Report — kos- agents & skills

**Date:** 2026-06-27
**Scope:** Align the full set created by the per-workflow loops: 18 agents (`.claude/agents/kos-<workflow>.md`) + 19 skills (`.claude/skills/kos-<capability>/SKILL.md`).

## Inputs reviewed
- All 18 agent files + their frontmatter `skills:` and body `## Skills to Activate and Use` sections.
- All 19 skill `SKILL.md` files (purpose + when_to_use + references).

## Rules applied (from GOAL.md → Orchestrator alignment)
- Dedupe **skills only**; agents are one-per-workflow and never merged.
- Two skills are duplicates if same name / same purpose / same functionality; **merge if >70% purpose similarity**.
- Survivor name = most-descriptive kebab (keep `kos-` prefix).
- Add missing skills to agent files if a gap remains.

## Pairwise similarity assessment (by purpose cluster)

| Cluster | Skills | Max pairwise purpose overlap | Decision |
|---|---|---|---|
| Failure knowledge | kos-zai-run-failure-prevention, kos-runner-disk-hygiene, kos-run-log-mining | ~30% (disk is one taxonomy leaf; mining is a method, prevention is the taxonomy) | keep all |
| Run / health | kos-run-monitoring (detect/diagnose/report), kos-workflow-health-optimization (optimize bottleneck) | ~35% (different verbs + workflows) | keep both |
| PR mechanics | kos-commit-and-push-branch, kos-pr-review-fix-loop, kos-rebase-conflict-resolution, kos-dependency-pr-review | <30% (distinct workflows/verbs) | keep all |
| Commit/push vs review-fix | kos-commit-and-push-branch (push mechanics), kos-pr-review-fix-loop (whole review-fix loop) | ~25% (one references the other) | keep both |
| Planning / issues / ideation | kos-planning-phase-execution, kos-issue-triage-inbox, kos-gsd-command-routing, kos-improvement-ideation, kos-docs-drift-detection, kos-autonomous-audit-fix, kos-daily-maintenance-sweep | <30% (each anchored to distinct workflow) | keep all |
| Meta / cross-cutting | kos-claude-turn-budget, kos-trigger-policy-trust-gate, kos-gh-automation-tooling | <20% | keep all |

**Highest-similarity pair:** kos-zai-run-failure-prevention ↔ kos-runner-disk-hygiene (~30%) — well under the 70% threshold. Disk-hygiene earns its own skill because it carries distinct operational depth (ensure-disk-space placement before install, Docker variant) and is referenced directly by 3 agents.

## Merges performed
**None.** No pair exceeds the 70% purpose-similarity threshold. The set was authored with awareness of the full map, so no duplication was introduced to dedupe.

## Agents merged
**None** (rule: agents never merged). 18 agents for 18 workflows, 1:1.

## Consistency checks (all pass)
- All 18 agents list skills in **both** frontmatter `skills:` (4–6 each) and body `## Skills to Activate and Use`. ✓
- Every skill referenced by an agent exists as a skill dir. ✓
- Every skill is referenced by ≥1 agent (no orphan skills). ✓
- All 18 agents + 19 skills have valid YAML frontmatter (`name:` + `description:` + closing `---`). ✓

## Gaps found & filled
None. Each observed failure mode (see final-review sufficiency trace) is covered by an agent checklist + ≥1 skill.

## Known issue carried forward
- **GOAL.md says "19 workflows"; the authoritative "Workflows to improve" table lists 18.** All 18 listed workflows were processed. The count mismatch is a goal-doc inconsistency, surfaced (not silently "corrected"). No workflow in the table was skipped.

## Conclusion
Aligned set = 18 agents + 19 skills, 0 merges, 0 gaps. Ready for final review.
