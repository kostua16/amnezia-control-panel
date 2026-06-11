# Phase 13.1 Verification: Workflow governance hardening

## Implemented

- Added `.github/workflows/workflow-governance.yml` to validate workflow governance on `.github/**` changes.
- Added `.github/workflows/scripts/workflow-governance-check.cjs` to enforce:
  - external action SHA pinning
  - top-level workflow permissions
  - pull_request_target allow-list
  - job `timeout-minutes`
  - required governance config presence
- Added `.github/branch-protection-recommendations.md` with required status checks and branch protection guidance.
- Added missing top-level `permissions` and job timeouts across existing workflows.
- Updated `ci.yml` with least-privilege top-level permissions and a dedicated `Unsafe SQL Guard` job.

## Evidence

- Ran `node .github/workflows/scripts/workflow-governance-check.cjs`.
- Result: `Errors: 0`, `Warnings: 0`.

## Notes

- Phase plan `CONTEXT.md` was requested but no 13.1 context file exists in `.planning/phases/13.1-workflow-governance-hardening/`.
