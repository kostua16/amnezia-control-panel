---
status: complete
date: 2026-06-11
---

# Summary

Fixed PR #291 workflow governance failures by pinning the `classify-trigger` checkout action in `.github/workflows/pr-flow.yml` to the current `actions/checkout` v5 SHA and adding `timeout-minutes: 5` to the job.

## Verification

- `/opt/homebrew/bin/gh api repos/actions/checkout/git/ref/tags/v5`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node .github/workflows/scripts/workflow-governance-check.cjs`
- `/opt/homebrew/bin/actionlint .github/workflows/pr-flow.yml`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx prettier --check .github/workflows/pr-flow.yml .planning/quick/260611-8f6-fix-pr-291-workflow-governance-failures-/PLAN.md`
- `rg -n "actions/checkout@v5|classify-trigger:|timeout-minutes" .github/workflows/pr-flow.yml`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm run lint`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test`
- `git diff --check -- .github/workflows/pr-flow.yml .planning/quick/260611-8f6-fix-pr-291-workflow-governance-failures-/PLAN.md`
