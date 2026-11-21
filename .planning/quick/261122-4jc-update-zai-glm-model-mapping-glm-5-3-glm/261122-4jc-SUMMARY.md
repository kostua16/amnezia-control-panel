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
claude, code-review, fix-issue, gsd-planning, suggest-improvements, pr-improve,
monitor-amnezia-control-panel-github-runs, workflow-health-optimize, audit-fix,
audit-auto-prs, project-manager, rebase-pr.

glm-5.3-flash (`sonnet`/`haiku`) — executing an existing plan, fixing known findings, triage, sweeps, simple edits:
fix-review, gsd-planning-execute (+ validation repair), issue-catch-up, _auto-fix-ci,
docs-drift, maintenance, dependency-review, release-notes, triage.

## Verification

- `prettier --check` on all workflow YAML: pass.
- `npm run test-only` and workflow `node --test`: same 36 / 8 failures with and without the change (Windows CRLF / env, unrelated to models).
