---
status: investigating
trigger: "Investigate and prepare fix for kostua16/amnezia-control-panel#522 in new PR"
created: 2026-06-28
updated: 2026-06-28
---

# Debug: PR #522 rebase automation reports DISALLOWED_TOOLS

## Symptoms

- PR #522 is open and dirty against `main`.
- PR head: `2058bebd4b0a6ffa86bd61545322d57bf9e79065`.
- User requested `/rebase` on 2026-06-27.
- Rebase workflow run `28303875922` completed successfully, but the sticky rebase comment says `Rebase failed`.
- Comment failure text reports `DISALLOWED_TOOLS` for direct `/usr/bin/node --test ... 2>&1 | tail ...` commands after 71 turns / 700s.
- Later validation and push steps were skipped, so the PR branch was not updated.

## Current Focus

- hypothesis: The trusted rebase workflow allows the ZAI resolver to run conflict-resolution logic but its tool policy rejects direct shell validation commands, causing the resolver to stop after conflicts instead of completing/pushing the rebase.
- test: Inspect `rebase-pr.yml`, trusted rebase control scripts, and workflow tests for the resolver prompt/tool policy and the failing command shape.
- expecting: A narrow workflow/script policy or prompt fix that permits only bounded validation commands needed by the rebase resolver, with tests preventing broad shell access.
- next_action: inspect rebase workflow scripts and reproduce the policy mismatch from current `origin/main`.

## Evidence

- 2026-06-28: PR #524, the earlier Prisma Safe SQL guard fix, is already merged into `main`; current PR #522 symptom is no longer that guard.
- 2026-06-28: `gh pr view 522` shows `mergeStateStatus=DIRTY` and latest rebase comment body reports `DISALLOWED_TOOLS`.
- 2026-06-28: `gh run view 28303875922` shows workflow/job conclusion `success`; resolver step completed, then validate/push/new-head steps were skipped.

## Eliminated

- hypothesis: The old Prisma Safe SQL false positive is still the blocker.
  reason: The fix PR #524 was merged on 2026-06-26; current live comment points to `/rebase` resolver tool policy.

## Root Cause

The rebase conflict resolver reached a moved-head state, but it attempted
validation through absolute `/usr/bin/node --test ...` commands wrapped with
`tail`/shell status plumbing. Those Bash command shapes are outside
`rebase-pr.yml`'s allowlist. The same prompt also told the resolver to use
`git -c core.editor=true rebase --continue`, while the allowlist only covered
`git rebase:*`, leaving the canonical no-editor continue command uncovered.

## Fix

- Add the narrow `Bash(git -c core.editor=true rebase --continue:*)` allowlist entry.
- Make the rebase prompt and `kos-rebase-pr` knowledge layer explicit: use
  allowlisted relative commands only, prefer `rtk node --test ...` for targeted
  workflow tests, avoid absolute binaries and shell wrappers, and leave full
  CI-matching validation to `validate-pr-gate`.
- Add a workflow invariant test for the rebase resolver command contract.

## Verification

- `npx tsx --test src/lib/__tests__/workflow-triggers.test.ts` passed.
- `npm run test-only` passed after `npx prisma generate`.
- `.github/workflows` script suite passed with `node --test scripts/__tests__/*.test.cjs`.
- `npm run lint` passed with existing warnings only.
- Targeted `prettier --check` passed for changed files.
- `actionlint -config-file .github/actionlint.yaml` passed.
- `git diff --check` passed.

## Files Changed

- `.github/workflows/rebase-pr.yml`
- `.claude/agents/kos-rebase-pr.md`
- `.claude/skills/kos-rebase-conflict-resolution/SKILL.md`
- `src/lib/__tests__/workflow-triggers.test.ts`
- `docs/workflow-e2e-scenarios.md`
