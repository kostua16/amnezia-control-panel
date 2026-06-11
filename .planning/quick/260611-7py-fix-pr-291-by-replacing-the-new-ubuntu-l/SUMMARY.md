---
status: complete
date: 2026-06-11
---

# Summary

Updated PR #291 so the new PR Orchestrator `classify-trigger` preflight job uses `self-hosted` instead of `ubuntu-latest`, and adjusted the two workflow invariant tests to assert the same runner convention.

## Verification

- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx prisma generate`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm run lint`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx prettier --check src/lib/__tests__/pr-flow-watchdog.test.ts src/lib/__tests__/workflow-triggers.test.ts`
- `/opt/homebrew/bin/actionlint .github/workflows/pr-flow.yml`
- `git diff --check`
- `rg -n "ubuntu-latest" .github/workflows/pr-flow.yml src/lib/__tests__/pr-flow-watchdog.test.ts src/lib/__tests__/workflow-triggers.test.ts`
