---
status: complete
completed_at: '2026-06-12T17:26:17Z'
slug: convert-auto-pr-audit-workflow
---

# Convert Auto PR Audit To GitHub Workflow

Added a dedicated `audit-auto-prs` GitHub Actions workflow that runs the
automation-created PR audit through `run-zai` every three hours and by manual
dispatch. Follow-up update: workflow-created PRs are ready for review, not
drafts.

## Completed

- Added `.github/workflows/audit-auto-prs.yml`.
- Reused shared automation branch, duplicate detection, commit/push, rich PR
  body, PR upsert, and failure reporting actions.
- Updated `.github/workflows/documentation.md` with secret usage and workflow
  map notes.

## Verification

- `rtk actionlint .github/workflows/audit-auto-prs.yml`
- `rtk node .github/workflows/scripts/workflow-governance-check.cjs`
- `rtk npx prettier --check .github/workflows/audit-auto-prs.yml .github/workflows/documentation.md .planning/quick/20260612-convert-auto-pr-audit-workflow/PLAN.md`
