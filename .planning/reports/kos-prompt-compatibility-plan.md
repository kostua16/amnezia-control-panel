# kos- prompt-compatibility remediation — executed plan

**Date:** 2026-06-27 · **Status:** COMPLETE · **Approved plan:** `~/.claude/plans/1-agent-file-and-moonlit-taco.md`
**Model:** workflow `prompt:` is master; `kos-` agents/skills extend/enforce it and never contradict it. Prompts untouched.

## Goal
Make every `kos-` agent faithfully enforce its workflow prompt's contract (no-push, exact JSON/verdict tokens, scope, verify, tool rules) and add run-mined knowledge — without instructing the agent to do anything the prompt reserves for workflow steps.

## Steps executed

- **Step 0 — `kos-zai-agent-runtime-contract` (new shared skill).** Universal enforce layer: prompt is master; agent edits files + returns prompt's exact JSON; never push/commit/PR/mutate; `rtk gh` only when allowed; obey no-gh/git/network; verify with prompt's commands. Added to all 18 agents. ✅
- **Step 1 — removed 6 🔴 push/commit contradictions.** fix-review, fix-issue, rebase-pr, audit-fix, audit-auto-prs, workflow-health-optimize — reframed to edit-only; workflow steps own Git/PR/gate. ✅
- **Step 2 — fixed 5 🟠 output schemas/verdict tokens.** code-review (`passed|concerns` + STRIDE/OWASP JSON), dependency-review (`passed|manual|blocked`), pr-improve (`quick_tasks`/`phase_suggestions`), fix-review JSON, rebase-pr JSON. ✅
- **Step 3 — closed 5 🟡 mechanics gaps.** monitor (allow narrow fixes), suggest-improvements (`.planning` write + dedup vs open PRs), issue-catch-up (6 phases + DRY/RATE-LIMITED), triage (label rules + helper scripts), gsd-planning-execute (`Proposals deferred` + `npm test`). ✅
- **Step 4 — polished 4 compatible agents.** claude, maintenance, gsd-planning, docs-drift (runtime-contract + Prompt-contract + minor). ✅
- **Step 5 — reframed 12 skills.** commit-and-push-branch (workflow-step, agents don't push), claude-turn-budget + improvement-ideation (attribution fix), pr-review-fix-loop (review-only + both JSON), dependency-pr-review (tokens), rebase-conflict-resolution (conflict+feedback focus), autonomous-audit-fix (fixed/manual JSON), run-monitoring (narrow fixes, rtk gh), workflow-health-optimization (provided JSON, no gh), issue-triage-inbox (triage rules + 6-phase), docs-drift-detection (scope, no git/gh), planning-phase-execution (deferred-proposals + npm test). ✅
- **Step 6 — alignment + lint.** 0 merges; audit-auto-prs no longer references autonomous-audit-fix; MD040 resolved (fence languages added). ✅
- **Step 7 — documented + aligned 3 reference docs.** `.github/workflows/documentation.md` (Workflow Knowledge Layer section + map + See-also), `docs/code-standards.md` (Workflow knowledge layer alignment rule), `docs/workflow-e2e-scenarios.md` (Knowledge-layer alignment note + §3/§4/§6 cross-refs). Alignment audit confirmed remediated agents match characterized behavior (agent-edits-only / workflow-pushes-&-gates). ✅

## Files changed (summary)
- 1 new skill: `kos-zai-agent-runtime-contract`.
- 12 skills reframed (version → 1.1).
- 18 agent files rewritten (added runtime-contract + Prompt-contract; no-push; exact JSON; mechanics).
- 3 reference docs extended.
- 2 reports (this file + `kos-prompt-compatibility-review.md`).

## Verification (all green — see review doc)
Frontmatter (18+20) ✓ · consistency (20=20, no orphans) ✓ · universal runtime-contract ✓ · compatibility self-check 17/17 ✓ · no-imperative-push ✓ · workflow-triggers guardrail 19/19 ✓ · no test references changed paths ✓ · MD040 0 bare openers ✓.

## Out of scope / next
- Empirical validation is post-merge (first real `run-zai` runs).
- Optional follow-up: wire workflow prompts to invoke their `kos-` agent (today prompts call `/gsd:*` only); the knowledge layer currently stands as enforced documentation + the runtime-contract skill.
- Not pushed / no PR — left for the user.
