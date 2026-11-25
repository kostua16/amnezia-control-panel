# Goal: Improve workflows by extracting run knowledge into agents + skills

## Idea

Improve the repo's workflows by extracting knowledge from each workflow's latest runs and storing it as new agents and skills, so repeated issues, missing knowledge, and incorrect behaviors stop recurring. The output is a set of agent files + skill files that encode what the runs teach us.

## Glossary

- **workflow** — one of the named automated processes listed in "Workflows to improve". The names in that list ARE the GitHub workflow filenames (e.g. `.github/workflows/<name>.yml`).
- **run** — one execution of a workflow. Read from GitHub Actions.
- **knowledge** — reusable information distilled from runs: (a) repeated issues that can be encoded once and reused, (b) missing knowledge the runtime re-derives every run (wasted time), (c) incorrect behavior that can be corrected, (d) lacked knowledge that blocked a task, (e) failed tool calls / misuse patterns to avoid.
- **agent** (`.claude/agents/kos-<workflow-name>.md`) — the role that **drives** a workflow. One per workflow. Built from `@.planning/AGENT-TEMPLATE.md`.
- **skill** (`.claude/skills/kos-<capability>/SKILL.md`) — a **reusable procedure** an agent calls. Many per workflow; may be shared across workflows. `@.planning/SKILL-TEMPLATE.md` is the content of the `SKILL.md` file inside the skill's directory.
- **zai** — the agent runtime that executes these workflows (the thing whose runs we are mining).
- **orchestrator** — the session that aligns all agents/skills after every per-workflow loop finishes.
- **review session** — a session that critiques one agent file + its skills and emits an APPROVED/REJECTED verdict.
- **fix session** — a session that implements a review session's issue list.

## Conventions

- **Agent vs skill:** agent = the role that drives a workflow; skill = a reusable procedure that agent calls. If it is about *doing the workflow*, it is the agent; if it is a *reusable step*, it is a skill.
- **Agent file:** `.claude/agents/kos-<workflow-name>.md`, from `@.planning/AGENT-TEMPLATE.md`. One per workflow.
- **Skill file:** `.claude/skills/kos-<capability>/SKILL.md` — each skill is a **directory** containing a `SKILL.md` file (`@.planning/SKILL-TEMPLATE.md` is that file's content). Capability-named (kebab), not workflow-named — skills are shareable.
- **`kos-` prefix (grouping):** all agents and skills from this effort are grouped with a `kos-` name prefix (e.g. `kos-code-review`, `kos-run-log-extraction`). Claude Code does **not** support extra grouping subfolders under `.claude/agents/` (flat files) or `.claude/skills/` (discovery is one level: `.claude/skills/*/SKILL.md`), so grouping is done by name prefix, not a `kos/` subfolder. The frontmatter `name:` field of each agent/skill uses the same `kos-` prefixed value.
- **Skills referenced both ways:** every agent file MUST list its skills in BOTH (1) the frontmatter `skills:` field (as a list, e.g. `skills: [kos-skill-a, kos-skill-b]`) AND (2) the body `## Skills to Activate and Use` section.

## Data source

- Latest **min(30, available)** runs per workflow, **all-time** (not a recency window).
- Fetch via: `gh run list --workflow <name> --limit 30` to enumerate runs, then `gh run view --log` per run to read logs.
- `<name>` is the workflow filename from the list below.

## Requirements

- [ ] Each workflow is investigated in its own agent session, up to 2 sessions in parallel.
- [ ] Orchestrator reviews all created agents and skills and aligns them (dedupe/merge skills, re-run agents if something is missing, add missing skills to agent files) — but ONLY after every per-workflow loop has finished.
- [ ] For each new agent file, define the list of skills it uses and reference them in the agent file (frontmatter `skills:` + body section).
- [ ] Run a review session per agent file that strongly reviews the agent file and its referenced skills and confirms they are sufficient for workflow improvement.
- [ ] For each review's issues, spawn a fix session and repeat review. Stop only when review APPROVES or the 4-round cap is hit (see Review contract).

## Plan

### Per-workflow loop (x19 workflows, max 2 in parallel)

For each workflow in "Workflows to improve":

1. Read its latest min(30, available) runs (see Data source).
2. Extract all knowledge across the 5 categories (see Glossary -> knowledge).
3. Store extracted knowledge into a new agent (`.claude/agents/kos-<workflow-name>.md`) and new skills (`.claude/skills/kos-<capability>/SKILL.md`, many, shareable).
4. In the agent file, list + reference the skills it uses (frontmatter + body).
5. Run a review session (see Review contract).
6. If REJECTED: spawn a fix session to address the listed issues in the agent file and skills, then re-review. Repeat.
7. Stop this workflow's loop when review returns APPROVED, OR when the 4-round cap is reached (see Review contract -> round-4 rule).

### Review contract

- The review session must answer with exactly one of:
  - `<promise>APPROVED</promise>` — plus a summary of why it is sufficient.
  - `<promise>REJECTED</promise>` — plus a summary and an explicit **list of issues** (each issue actionable enough to drive a fix session).
- **Sufficiency bar:** APPROVED only if the agent + its skills would have prevented each repeated failure mode seen in the extracted runs, would prevent the failed tool calls / misuse patterns, and all lacked knowledge has been gathered into the new agent/skills.
- **4-round cap:** at most 4 review rounds per workflow.
- **Round-4 rule:** if round 4 returns REJECTED, accept-with-known-issues — log the outstanding issues, mark the workflow's loop done, and carry that known-issues list forward into the final review. Do NOT start a 5th round.

### Orchestrator alignment (after ALL per-workflow loops finish)

- Review every created agent and skill and align them.
- **Dedupe skills only** (agents are one-per-workflow, never merged): two skills are duplicates if they share the **same name, OR same purpose, OR same functionality**. Merge duplicates into one.
- **Merge threshold:** if more than 70% of two skills' purposes are similar, merge them into one skill.
- **Survivor name:** the most-descriptive kebab name among the merged set wins (keep the `kos-` prefix).
- If something is still missing after alignment, re-run the relevant agent session and/or add the missing skills to the relevant agent file(s).

### Final review

- Review the full aligned set of agents and skills and confirm they are sufficient for workflow improvement (same sufficiency bar as the Review contract).
- If issues are found: loop back to the **offending workflow's per-workflow loop** (not a global restart).

## Success criteria

- Sufficiency bar met (see Review contract) for every workflow.
- Termination proxy: no new lacked-knowledge pattern surfaced in the last review round of a workflow.
- Validation note: no empirical pre-merge check is possible locally, so pre-merge the gate is subjective review approval. Empirical validation happens **after merge**, via the first real runs.

## Exit criteria

- [ ] All 19 workflows are processed.
- [ ] All agents and skills are created.
- [ ] All per-workflow review loops finished (APPROVED, or round-4 accept-with-known-issues logged).
- [ ] Orchestrator alignment complete (skills deduped/merged per rules).
- [ ] Final review finishes with APPROVE.

## Risks & mitigations

- **Extraction may miss knowledge** -> mit: extract across all 5 knowledge categories; review loop + termination proxy gate completeness; 4-round cap prevents infinite chasing.
- **Fix sessions may not resolve issues** -> mit: each fix session works from the review's explicit issue list as a checklist; re-review verifies each item.
- **Reviews may not be thorough** -> mit: review must cite specific runs / failure modes; APPROVED only if the sufficiency bar is met.
- **Orchestrator may mis-dedupe** -> mit: dedupe rule is explicit (>70% purpose similarity threshold, kebab survivor name); agents are never merged.
- **Pipeline may not terminate** -> mit: 4-round cap + round-4 accept-with-known-issues; orchestrator strictly after all loops; final review loops to a specific workflow, not globally.
- **Parallel write conflicts** -> mit: orchestrator runs only after all per-workflow loops finish, so no skill is edited while an agent session is still writing it.
- **Skills placed in a `kos/` subfolder won't be discovered** -> mit: convention mandates the `kos-` name prefix at the documented one-level path, not a subfolder (see Conventions).

## Workflows to improve

Names below are GitHub workflow filenames.

```text
workflow                                  tot   last 15 runs breakdown
────────────────────────────────────────  ───   ──────────────────────────
monitor-amnezia-control-panel-github-runs  15   ✅15
audit-auto-prs                             15   ✅15
code-review                                15   ✅15
maintenance                                15   ✅15
dependency-review                          13   ✅13
audit-fix                                  15   ⛔14 ❌1
workflow-health-optimize                   15   ✅9 ⏸6
gsd-planning-execute                       15   ✅14 ⛔1
pr-improve                                 15   ✅12 ⛔3
suggest-improvements                       15   ✅11 ⛔4
rebase-pr                                  15   ⏸12 ✅3
fix-review                                 15   ⏸10 ✅5
fix-issue                                  13   ⏸11 ✅2
claude                                     14   ⏸14
gsd-planning                               15   ⏸15
issue-catch-up                             15   ⏸15
triage                                     15   ⏸15
docs-drift                                  5   ⛔2 ❌2 ✅1
```
