---
status: complete
date: 2026-06-12
---

# Summary

Converted `graphify-out/` into ignored local generated state by removing the tracked graph artifacts from the Git index and replacing partial graphify ignore rules with a full `graphify-out/` ignore.

Updated graphify guidance in `CLAUDE.md`/`AGENTS.md` so agents treat the graph as local cache, use it when present, refresh it locally after code changes, and never stage or commit `graphify-out/**`.

Added generated-state PR policy protection for `graphify-out/**`: `evaluate-pr-policy.cjs` now marks those PRs manual-only and ineligible with a local-cache blocked reason, and `pr-policy.yml` publishes a separate failing `pr-policy/generated-state` status when a PR includes graphify generated state.

Added regression coverage for the generated-state policy and refreshed a stale trigger-policy test expectation so the workflow script suite passes.

## Verification

- `/Users/kostua16/.local/bin/rtk proxy git ls-files graphify-out`
- `/Users/kostua16/.local/bin/rtk git check-ignore graphify-out/graph.json`
- `/Users/kostua16/.local/bin/rtk /opt/homebrew/bin/node --test .github/workflows/scripts/__tests__/*.cjs`
- `PATH=/opt/homebrew/bin:$PATH /Users/kostua16/.local/bin/rtk /opt/homebrew/bin/npm run lint`
- `PATH=/opt/homebrew/bin:$PATH /Users/kostua16/.local/bin/rtk /opt/homebrew/bin/npx prettier --check .github/workflows/policy.json .github/workflows/pr-policy.yml .github/workflows/scripts/evaluate-pr-policy.cjs .github/workflows/scripts/__tests__/evaluate-pr-policy.test.cjs .github/workflows/scripts/__tests__/evaluate-trigger-policy.test.cjs CLAUDE.md .planning/quick/260612-x6c-convert-graphify-out-into-ignored-local-/260612-x6c-PLAN.md`
- `/Users/kostua16/.local/bin/rtk /Users/kostua16/go/bin/actionlint`
- `/Users/kostua16/.local/bin/rtk git diff --check`
- `/Users/kostua16/.local/bin/rtk /Users/kostua16/.local/share/uv/tools/graphifyy/bin/python -m graphify update .`
