---
status: complete
created: 2026-05-31T12:26:38Z
---

# Project-Mode GSD And RTK Tools

Install GSD and RTK configuration into the repository instead of relying on global Claude profile state, then commit the trusted `.claude` assets needed by GitHub Actions after `claude-code-action` restores `.claude` from the base branch.

## Plan

- Install GSD for Claude Code with `--local`.
- Initialize RTK in local/project mode.
- Update ignore rules so generated project assets are tracked while volatile local/session files remain ignored.
- Restore `/gsd-quick` in `pr-improve` once the command file is present in the repository.
- Verify workflow YAML and formatting/lint expectations for changed files.

## Outcome

- GSD is installed in project-local `.claude` assets, including `/gsd-quick`.
- RTK is initialized in project mode through committed `CLAUDE.md` instructions and `.claude/settings.json` hook configuration; CI no longer patches the runner global Claude profile.
- `.gitignore` now tracks the required Claude/GSD/RTK assets and keeps local/session install state ignored.
- Verification covered actionlint, JSON parsing, GSD command presence, generated hook syntax, app lint, and Prettier checks.
