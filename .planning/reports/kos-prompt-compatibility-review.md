# kos- prompt-vs-agent compatibility review

**Date:** 2026-06-27
**Scope:** all 18 `kos-<workflow>` agents vs their workflow `prompt:` in `.github/workflows/<name>.yml`.
**Model (per user decision):** the workflow `prompt:` is master; `kos-` agents/skills **extend and enforce** it (add run knowledge, prevent repeated mistakes) and **never contradict** it. Prompts untouched.

## Headline

The first pass of agents inverted the **agent↔workflow boundary**: several told the zai agent to push/commit/open-PR/force-push — actions every relevant prompt reserves for workflow steps (`commit-and-push`, `upsert-pull-request`, `validate-pr-gate`, `report-failure`). Output JSON/verdict tokens and a few workflow purposes/mechanics were also wrong. Remediation rewrote all 18 agents + 12 skills + added 1 universal skill (`kos-zai-agent-runtime-contract`).

## Per-workflow verdict (before → after)

| Workflow | Was | Fix applied | Now |
|---|---|---|---|
| fix-review | 🔴 agent told to push; wrong verify | edit-only; full gate `npm run format`+`npm run test && npm run build`; never `$queryRawUnsafe`; JSON `{summary,changed_files,findings_addressed,findings_skipped,validation}`; workflow pushes | ✅ |
| fix-issue | 🔴 agent told to push/open PR | edit-only; single root cause; `npm run lint && npx tsc --noEmit`; stop@60; `## Fixed/## Remaining` comment | ✅ |
| rebase-pr | 🔴 agent told to force-push | resolve conflicts (preserve intent+base+review feedback); `git -c core.editor=true rebase --continue`; clean tree; JSON; workflow force-with-lease | ✅ |
| audit-fix | 🔴 agent ran git/gh/push | edit-only; no git/gh; `npm run`/`npx` only; `fixed_findings`+`manual_findings`+`### Manual-only findings` | ✅ |
| audit-auto-prs | 🔴 wrong purpose (code audit) + push | **purpose fix:** audit open automation PRs; `rtk gh` only; no mutate/push; evidence report | ✅ |
| workflow-health-optimize | 🔴 agent ran gh/network | **tool-rule fix:** provided Completed Runs Data JSON only; ASSESS/PLAN/EXECUTE; ≤3 workflow files | ✅ |
| code-review | 🟠 APPROVE/REQUEST_CHANGES prose | JSON `code_review.{verdict passed\|concerns,…}`, `security_review.{…}`, `reviewed_files`; no approve/label | ✅ |
| dependency-review | 🟠 APPROVE/REQUEST_CHANGES | JSON `verdict passed\|manual\|blocked`, `update_type`, `risk_notes`; no approve/label | ✅ |
| pr-improve | 🟠 generic JSON | JSON `quick_tasks[]`+`phase_suggestions[]` (4 buckets); no edit/push/comment | ✅ |
| monitor-…-runs | 🟡 "diagnose only" too strict | allows narrow evidence-backed fixes; `rtk gh`/`rtk proxy gh`; no push | ✅ |
| suggest-improvements | 🟡 wrong mechanism | writes `.planning/ROADMAP.md`+`.planning/quick/**`; dedup vs `/tmp/open-prs-context.md` | ✅ |
| issue-catch-up | 🟡 generic routing | 6 phases; DRY-RUN + RATE-LIMITED modes; exact `gh` commands | ✅ |
| triage | 🟡 generic labels | exactly-one priority label; `backlog` for fixAvailable:false; `triaged` via `edit-issue-labels.sh`; exact summary | ✅ |
| gsd-planning-execute | 🟡 missing sections | `### Proposals deferred`; `npm test` gate; `--no-transition` | ✅ |
| claude | ✅ routing | added runtime-contract + Prompt-contract | ✅ |
| maintenance | ✅ sweep | added exact issue titles/labels + runtime-contract | ✅ |
| gsd-planning | ✅ refresh | added preserve-intake/auto-merge + runtime-contract | ✅ |
| docs-drift | ✅ docs-only | added allowed scope + no git/gh + runtime-contract | ✅ |

## 4 discrepancy patterns (root causes)
1. **Push/commit boundary inverted** — the mined "commit-and-push failure" was misread as an *agent* action; it is a *workflow step* after the agent.
2. **Output JSON / verdict tokens wrong** — paraphrased schemas the downstream steps parse.
3. **Purpose/mechanism wrong** — audit-auto-prs (PR audit not code audit); workflow-health-optimize (no `gh`); suggest-improvements (`.planning` write, not `/gsd:capture`).
4. **Workflow mechanics under-specified** — triage label rules, issue-catch-up phases/modes, verify gates.

## Attribution fix
`kos-claude-turn-budget` and `kos-improvement-ideation` previously attributed a `≤6/≤20/≤6` turn allocation to the `pr-improve` prompt. The current `pr-improve.yml` has no such allocation (it appeared in a failed run's log). Both skills now frame it as a reusable phasing pattern, not a prompt quote.

## Verification (run, all green)
- Frontmatter validity: 18 agents + 20 skills — none invalid.
- Consistency: every agent lists skills in frontmatter **and** body; every referenced skill exists; every skill referenced (no orphans). 20 distinct skills = 20 dirs.
- Universal: every agent references `kos-zai-agent-runtime-contract`.
- Mechanical compatibility self-check (per-workflow token/no-push assertions): **17/17 PASS**.
- No-imperative-push: no agent instructs push/commit/open-PR (the one substring hit in `kos-fix-review` is the explicit *"workflow step … not your action"* note).
- Guardrail test `src/lib/__tests__/workflow-triggers.test.ts`: **19/19 pass** (no workflow YAML changed).
- No test references the changed paths (src or scripts) — the e2e suite is unaffected (markdown-only changes).
- markdownlint not installed in repo; MD040 (fenced-code-language) resolved by adding languages to all bare opening fences (0 bare openers remain).

## Alignment change
`kos-audit-auto-prs` no longer references `kos-autonomous-audit-fix` (different purpose: PR audit vs code audit). Skill merges: 0 (none exceed the 70% purpose-similarity threshold).

## Empirical validation
Post-merge — via the first real `run-zai` runs of each workflow (per GOAL.md success criteria; no local pre-merge empirical check for agent/skill markdown).

## See also
- Executed plan: `.planning/reports/kos-prompt-compatibility-plan.md`.
- Workflow knowledge layer map: `.github/workflows/documentation.md` → Workflow Knowledge Layer.
- Alignment rule: `docs/code-standards.md` → Workflow knowledge layer.
- Behavior source of truth: `docs/workflow-e2e-scenarios.md` → Knowledge-layer alignment.
