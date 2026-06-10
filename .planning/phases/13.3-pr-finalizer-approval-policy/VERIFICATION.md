# Phase 13.3 Verification: PR finalizer and approval policy

## Implemented

- Added `.github/workflows/pr-policy.yml` for PR metadata governance.
- PR policy now:
  - auto-labels PR size
  - auto-labels changed-file areas
  - applies `needs-review` for workflow/planning or security-sensitive test paths
  - enforces Conventional Commit format for PR title and commit subjects
  - writes `pr-policy/conventional-commits` commit status
- Added size and area labels to `.github/workflows/policy.json`.
- Updated `.github/pr-flow.json` required checks to include `CI / Unsafe SQL Guard` and `PR Policy / label-and-validate`.

## Evidence

- Ran `node .github/workflows/scripts/workflow-governance-check.cjs`.
- Result: `Errors: 0`, `Warnings: 0`.

## Notes

- `pr-policy.yml` uses `pull_request_target` only for metadata, labels, and statuses. It does not checkout or execute PR head code.
- Phase plan `CONTEXT.md` was requested but no 13.3 context file exists in `.planning/phases/13.3-pr-finalizer-approval-policy/`.
