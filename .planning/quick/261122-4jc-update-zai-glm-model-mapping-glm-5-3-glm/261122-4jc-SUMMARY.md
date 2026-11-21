---
status: complete
quick_id: 261122-4jc
---

# Quick 261122-4jc: ZAI/GLM model mapping per workflow task type

## Alias mapping (`.github/actions/run-zai/action.yml`)

| alias            | before        | after            |
| ---------------- | ------------- | ---------------- |
| haiku (subagent) | glm-4.7       | glm-5.3-flash    |
| sonnet (default) | glm-5-turbo   | glm-5.3-flash    |
| opus             | glm-5.2       | glm-5.3          |

## Per-workflow `model:`

glm-5.3 (`opus`) — analysis, planning, root-cause debugging, review decisions:
claude, code-review, fix-issue, fix-review, fix-pr/fix-branch (_auto-fix-ci), gsd-planning, suggest-improvements,
pr-improve, monitor-amnezia-control-panel-github-runs, workflow-health-optimize,
audit-fix, audit-auto-prs, project-manager, rebase-pr.

glm-5.3-flash (`sonnet`/`haiku`) — executing an existing plan, fixing known findings, triage, sweeps, simple edits:
gsd-planning-execute (+ validation repair), issue-catch-up,
docs-drift, maintenance, dependency-review, release-notes, triage.

## Verification

- `prettier --check` on all workflow YAML: pass.
- `npm run test-only`: 36 failures, unchanged with and without the change (Windows CRLF / env, unrelated to models).
- Workflow `node --test` (`.github/workflows/scripts/__tests__`): 8 failures reported; a clean baseline comparison was not run for this suite.

## Review follow-up (PR #1138)

- fix-review restored to `opus`: it runs `/gsd:debug` (root-cause debugging) on review findings with the security-guidance plugin loaded, which the inventory maps to glm-5.3.
- claude/fix-issue/gsd-planning plan jobs raised from 10- to 30-minute timeouts to fit opus per-turn latency. STOP_BY deadline wiring applies to claude.yml and fix-issue.yml only — gsd-planning.yml got the timeout raise alone (no compute-stop-by-deadline step, no STOP_BY prompt line). The workflow-inventory rows (claude.yml/fix-issue.yml/workflow-health-optimize.yml Model column, fix-issue Timeout/MAX_TURNS) still need the matching update — `.claude/skills/` was not writable in the fix run.
- `glm-5.3` / `glm-5.3-flash` verified against the ZAI API on 2026-11-21: both IDs returned HTTP 200 with the model echoed back on a minimal `/v1/messages` probe run from CI against `https://api.z.ai/api/anthropic`. Nothing validates them at runtime in-repo (the 429 probe only retries HTTP 429), so a future invalid ID still fails the first `run-zai` run fast and visibly.
- claude.yml `MAX_TURNS` lowered from 100 to 60 to fit the 30-minute opus budget — the budget also covers the setup phase (deps, gsd, rtk, uv), and 60 turns matches the turns-per-minute ratio of the other 30-minute opus jobs (fix-issue, gsd-planning).
- `subagent-model` stays flash by default on purpose — delegated subagent work is execution-style; a workflow wanting opus-grade subagent analysis sets `subagent-model: 'opus'` explicitly.
- Scheduled opus runs (monitor hourly, workflow-health-optimize hourly, audit-auto-prs every 3h) are deliberate; MAX_TURNS plus the job timeout are the cost bound.
