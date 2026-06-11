---
status: complete
date: 2026-06-11
---

# Fix PR #291 PR Flow Preflight Runner

## Goal

Replace the new PR Orchestrator preflight job's hosted `ubuntu-latest` runner with the repository's self-hosted runner convention, update the matching invariant tests, then verify, commit, push, and approve PR #291.

## Tasks

- Change only the `classify-trigger` job in `.github/workflows/pr-flow.yml` from `ubuntu-latest` to `self-hosted`.
- Update PR flow invariant tests that assert the preflight runner name.
- Verify tests, lint, Prettier for changed TypeScript tests, workflow syntax when available, and diff cleanliness.
- Commit and push the scoped fix to `codex/260611-pr-flow-label-preflight`.
- Approve PR #291 with GitHub CLI if GitHub permissions allow it.
