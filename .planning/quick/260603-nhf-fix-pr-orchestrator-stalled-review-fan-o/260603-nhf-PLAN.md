---
status: in-progress
created: 2026-06-03
quick_id: 260603-nhf
---

# Fix PR orchestrator stalled review fan-out

## Goal

Fix the PR Orchestrator check gate so a completed CI `workflow_run` can fan out
to code review and finalizer workflows even when `gh pr checks` cannot see the
PR check contexts.

## Tasks

- Add explicit check/status read permissions and a `flow/checks-unavailable`
  diagnostic label.
- Add a workflow-run job fallback for completed required CI runs matching the
  PR head SHA.
- Include check source diagnostics in orchestrator JSON output.
- Cover the fallback and unavailable states in existing orchestrator tests.
- Run lint, format checks, tests, typecheck, and workflow syntax checks where
  available.
