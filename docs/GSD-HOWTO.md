# GSD Commands and Workflows

GSD is the project workflow layer for planning, executing, validating, and preserving context across sessions. It wraps every significant change in planning artifacts, atomic commits, and state tracking so you can pick up where you left off. Use this cheatsheet to pick the right command and follow the daily workflow.

> Primary form in this guide: `/gsd-*`. Many commands are also surfaced as `/gsd/<name>` aliases; use whichever the local assistant surface exposes.

## Quick command picker

| Need | Use | Why |
|------|-----|-----|
| Start a new project | `/gsd-new-project` | Initialize PROJECT.md, roadmap, first milestone |
| Start a new milestone | `/gsd-new-milestone` | Archive old milestone, set up new one |
| Check progress | `/gsd-progress` | Unified situational command — status, next step |
| View stats | `/gsd-stats` | Phases, plans, requirements, git metrics, timeline |
| Manage roadmap phases | `/gsd-phase` | Add, insert, remove, edit phases in ROADMAP.md |
| Plan work | `/gsd-spec-phase` → `/gsd-discuss-phase` → `/gsd-plan-phase` | Clarify scope → gather context → create plan |
| Plan MVP slice | `/gsd-mvp-phase` | Vertical MVP with user story and SPIDR splitting |
| AI system design | `/gsd-ai-integration-phase` | Generate AI-SPEC.md for AI phases |
| Cloud-assisted plan | `/gsd-ultraplan-phase` | Offload plan to Claude Code ultraplan cloud |
| Execute planned work | `/gsd-execute-phase` | Execute plans with wave-based parallelization |
| Small docs/ad-hoc task | `/gsd-quick` | Quick task with GSD guarantees, no planning overhead |
| Trivial one-step fix | `/gsd-fast` | Inline trivial task, no subagents |
| Debug bug/regression | `/gsd-debug` | Systematic debugging with persistent state |
| Verify built work | `/gsd-verify-work`, `/gsd-validate-phase` | Conversational UAT or retroactive validation |
| Code review | `/gsd-code-review` | Review changed files for bugs, security, quality |
| Security audit | `/gsd-secure-phase` | Verify threat mitigations for completed phase |
| UI review | `/gsd-ui-review` | 6-pillar visual audit of frontend code |
| Eval review | `/gsd-eval-review` | Audit AI phase evaluation coverage |
| Ship / PR | `/gsd-ship`, `/gsd-pr-branch` | Create PR, run review, prepare for merge |
| Resume context | `/gsd-resume-work`, `/gsd-thread` | Full context restoration or manage persistent threads |
| Pause work | `/gsd-pause-work` | Create context handoff mid-phase |
| Explore ideas | `/gsd-explore` | Socratic ideation before committing to plans |
| Get help | `/gsd-help` | Show available commands and usage guide |

## Daily workflow

1. **Check status**: `/gsd-progress` — see where you are, what's next.
2. **Choose path**:
   - Quick docs fix/ad-hoc → `/gsd-quick`
   - Planned phase → `/gsd-plan-phase N` then `/gsd-execute-phase N`
   - Bug → `/gsd-debug`
3. **Execute**: Run your chosen command. GSD handles planning artifacts, state tracking, and atomic commits.
4. **Validate**: `/gsd-verify-work` for conversational UAT, or targeted review (`/gsd-code-review`, `/gsd-secure-phase`).
5. **Wrap up**: `/gsd-pause-work` to hand off context, or `/gsd-ship` to create a PR.

## Command reference

### Start and lifecycle

| Command | Purpose | Typical input | Notes / Risk |
|---------|---------|---------------|---------------|
| `/gsd-new-project` | Initialize project | `--auto` | Creates PROJECT.md, roadmap, first milestone |
| `/gsd-new-milestone` | Start new milestone | Milestone name | Archives old milestone |
| `/gsd-progress` | Check progress / dispatch | `--next`, `--do "task"` | Unified situational command |
| `/gsd-stats` | Project statistics | (none) | Phases, plans, git metrics |
| `/gsd-help` | Usage guide | `--brief`, topic | Show available commands |
| `/gsd-settings` | Workflow toggles | (none) | Configure GSD preferences |
| `/gsd-config` | Advanced config | `--advanced`, `--integrations` | Knobs and integrations |
| `/gsd-surface` | Toggle skill visibility | `list`, `profile`, `disable` | Show/hide skill clusters |
| `/gsd-update` | Update GSD | `--sync`, `--reapply` | Update to latest version |
| `/gsd-health` | Diagnose .planning health | `--repair` | Check and fix planning issues |
| `/gsd-complete-milestone` | Archive milestone | Version | ⚠️ Destructive — archives current milestone |

### Phase workflow

| Command | Purpose | Typical input | Notes / Risk |
|---------|---------|---------------|---------------|
| `/gsd-phase` | Manage roadmap phases | `--insert`, `--remove`, `--edit` | CRUD in ROADMAP.md |
| `/gsd-spec-phase` | Clarify scope | Phase, `--auto` | Produces SPEC.md with ambiguity scoring |
| `/gsd-discuss-phase` | Gather context | Phase, `--auto`, `--assumptions` | Adaptive questioning before planning |
| `/gsd-plan-phase` | Create execution plan | Phase, `--auto`, `--tdd`, `--mvp` | Produces PLAN.md |
| `/gsd-mvp-phase` | Plan as vertical MVP | Phase number | User story + SPIDR splitting |
| `/gsd-ai-integration-phase` | AI system design contract | Phase number | Produces AI-SPEC.md |
| `/gsd-ultraplan-phase` | Cloud-assisted plan | Phase number | ⚠️ BETA — offloads to ultraplan cloud |
| `/gsd-plan-review-convergence` | Cross-AI plan review | Phase, `--all` | Replan until no HIGH concerns |
| `/gsd-execute-phase` | Execute plans | Phase, `--wave`, `--interactive` | Wave-based parallelization |
| `/gsd-verify-work` | Conversational UAT | Phase | User-facing validation |
| `/gsd-pause-work` | Context handoff | `--report` | Save context for next session |
| `/gsd-resume-work` | Restore context | (none) | Full context from previous session |

### Quick work and debugging

| Command | Purpose | Typical input | Notes / Risk |
|---------|---------|---------------|---------------|
| `/gsd-quick` | Quick task | Task description, `--research` | Atomic commits, state tracking |
| `/gsd-fast` | Trivial inline task | Task description | No subagents, no planning |
| `/gsd-debug` | Systematic debugging | Issue description, `--diagnose` | Persistent state across resets |
| `/gsd-forensics` | Post-mortem | Problem description | ⚠️ Diagnoses failed workflows |
| `/gsd-undo` | Safe git revert | `--last N`, `--phase NN` | ⚠️ Destructive — rolls back commits |

### Review, validation, and security

| Command | Purpose | Typical input | Notes / Risk |
|---------|---------|---------------|---------------|
| `/gsd-add-tests` | Generate tests | Phase | From UAT criteria and implementation |
| `/gsd-code-review` | Code review | Phase, `--depth`, `--fix` | Bugs, security, quality |
| `/gsd-secure-phase` | Security audit | Phase number | Verify threat mitigations |
| `/gsd-validate-phase` | Nyquist validation | Phase number | Fill validation gaps |
| `/gsd-ui-phase` | UI design contract | Phase | Produces UI-SPEC.md |
| `/gsd-ui-review` | Visual audit | Phase | 6-pillar visual review |
| `/gsd-eval-review` | Eval coverage audit | Phase number | AI phase evaluation |
| `/gsd-audit-uat` | Cross-phase UAT audit | (none) | Outstanding verification items |
| `/gsd-audit-fix` | Autonomous fix pipeline | `--source audit-uat` | ⚠️ Finds issues, classifies, fixes, commits |
| `/gsd-audit-milestone` | Milestone audit | Version | Audit completion before archiving |
| `/gsd-review` | Cross-AI peer review | `--phase N`, `--all` | External AI review of plans |
| `/gsd-ship` | Create PR | Phase or milestone | ⚠️ Creates PR, runs review |
| `/gsd-pr-branch` | Clean PR branch | Target branch | Creates branch without .planning commits |

### Docs and codebase intelligence

| Command | Purpose | Typical input | Notes / Risk |
|---------|---------|---------------|---------------|
| `/gsd-map-codebase` | Analyze codebase | `--fast`, `--focus`, `--query` | Produces .planning/codebase/ docs |
| `/gsd-graphify` | Knowledge graph | `build`, `query`, `status` | Build/query project knowledge graph |
| `/gsd-docs-update` | Update documentation | `--force`, `--verify-only` | Verified against codebase |
| `/gsd-ingest-docs` | Bootstrap planning | Path, `--mode` | From existing ADRs/PRDs/SPECs |
| `/gsd-extract-learnings` | Extract lessons | Phase number | Decisions, patterns, surprises |
| `/gsd-milestone-summary` | Project summary | Version | Comprehensive summary for onboarding |
| `/gsd-profile-user` | Developer profile | `--questionnaire` | Behavioral profile + artifacts |

### Ideation and intake

| Command | Purpose | Typical input | Notes / Risk |
|---------|---------|---------------|---------------|
| `/gsd-explore` | Socratic ideation | Idea description | Think before planning |
| `/gsd-sketch` | UI design mockup | Design idea, `--quick`, `--text` | Throwaway HTML mockups |
| `/gsd-spike` | Validate idea | Idea, `--quick`, `--text` | Experiential exploration |
| `/gsd-capture` | Capture ideas/notes | `--note`, `--backlog`, `--seed`, `--list` | Route to destination |
| `/gsd-import` | Ingest external plans | `--from filepath` | With conflict detection |
| `/gsd-review-backlog` | Review backlog | (none) | Promote items to active milestone |
| `/gsd-inbox` | Triage issues/PRs | `--issues`, `--prs`, `--repo` | Against project templates |

### Workspace, parallelism, and recovery

| Command | Purpose | Typical input | Notes / Risk |
|---------|---------|---------------|---------------|
| `/gsd-workspace` | Manage workspaces | `--new`, `--list`, `--remove` | Isolated environments |
| `/gsd-workstreams` | Parallel workstreams | (none) | Create, switch, status, complete |
| `/gsd-manager` | Interactive command center | `--analyze-deps` | Manage multiple phases |
| `/gsd-autonomous` | Run all remaining | `--from N`, `--to N`, `--interactive` | ⚠️ discuss→plan→execute per phase |
| `/gsd-cleanup` | Archive phase dirs | (none) | ⚠️ Archives completed milestone files |
| `/gsd-thread` | Context threads | `list`, `close`, `status` | Persistent cross-session context |

### Navigation namespaces

| Command | Purpose | Typical input | Notes / Risk |
|---------|---------|---------------|---------------|
| `/gsd-ns-workflow` | Workflow namespace | (none) | discuss → plan → execute → verify → phase |
| `/gsd-ns-context` | Context namespace | (none) | codebase intelligence → map → graphify |
| `/gsd-ns-ideate` | Ideation namespace | (none) | explore → sketch → spike → spec → capture |
| `/gsd-ns-manage` | Management namespace | (none) | config → workspace → workstreams → thread → ship |
| `/gsd-ns-project` | Project namespace | (none) | lifecycle → milestones → audits → summary |
| `/gsd-ns-review` | Review namespace | (none) | quality gates → code review → debug → audit → eval → UI |

## Current project examples

Quick docs update:

```bash
/gsd-quick prepare docs update for adding a GSD HOWTO link
```

Debug a stale status:

```bash
/gsd-debug investigate why server reachability status is stale
```

Plan a phase with existing research:

```bash
/gsd-plan-phase 12.8 --skip-research
```

Review a phase at standard depth:

```bash
/gsd-code-review 12.8 --depth=standard
```

Map the codebase architecture:

```bash
/gsd-map-codebase --fast --focus arch server management
```

Verify docs match the codebase:

```bash
/gsd-docs-update --verify-only
```

## Planning artifact map

| Artifact | Purpose |
|----------|---------|
| `.planning/PROJECT.md` | Project definition, current milestone, key decisions |
| `.planning/REQUIREMENTS.md` | Traceable requirements (REQ-ID) |
| `.planning/MILESTONES.md` | Milestone plan and progress tracking |
| `.planning/phases/*-PLAN.md` | Execution plan for a phase |
| `.planning/phases/*-CONTEXT.md` | Phase context and prerequisites |
| `.planning/phases/*-VERIFICATION.md` | Verification results |
| `.planning/phases/*-SUMMARY.md` | Completed phase summary |
| `.planning/phases/*-PATTERNS.md` | Code patterns discovered |
| `.planning/phases/*-RESEARCH.md` | Implementation research |
| `.planning/phases/*-UAT.md` | User acceptance test criteria |
| `.planning/phases/*-REVIEW.md` | Code review findings |
| `.planning/phases/*-VALIDATION.md` | Validation audit results |

## Safety notes

- ⚠️ `/gsd-undo` — Reverts git commits. Verify phase/plan scope before running.
- ⚠️ `/gsd-cleanup` — Archives completed milestone directories. Ensure milestone is truly finished.
- ⚠️ `/gsd-audit-fix` — Autonomous fix pipeline. Automatically finds, classifies, fixes, and commits changes.
- ⚠️ `/gsd-ship` — Creates a pull request. Review changes before merging.
- ⚠️ `/gsd-pr-branch` — Creates a clean PR branch. Filters out .planning commits.
- ⚠️ `/gsd-workspace --remove` — Removes an isolated workspace environment. Unsaved work is lost.
- ⚠️ `/gsd-complete-milestone` — Archives current milestone. Ensure all phases are reviewed.
- ⚠️ `/gsd-autonomous` — Runs all remaining phases autonomously. Review plan carefully before starting.
- ⚠️ `/gsd-forensics` — Post-mortem investigation. Run only on failed workflows.

## Verification and PR checklist

1. Run `npm run build` for general hygiene.
2. Verify local markdown links resolve.
3. PR title: `docs(gsd): GSD commands and workflows cheatsheet`.
4. PR description: documentation-only, files changed, QA commands and terminal-output summary.
5. Commit messages (preferred two commits):
   - `docs(gsd): add GSD commands cheatsheet` — `docs/GSD-HOWTO.md`
   - `docs(readme): link GSD HOWTO` — `README.md`
6. Single-commit fallback: `docs(gsd): add commands and workflows cheatsheet`
