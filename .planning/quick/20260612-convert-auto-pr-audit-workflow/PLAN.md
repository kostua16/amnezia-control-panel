---
status: complete
created_at: '2026-06-12T00:00:00Z'
slug: convert-auto-pr-audit-workflow
---

# Convert Auto PR Audit To GitHub Workflow

Add a dedicated scheduled/manual GitHub Actions workflow that runs the existing
auto-PR audit prompt through `run-zai`, creates a ready-for-review/manual PR only for
narrow systemic fixes, and records no-change or duplicate-suppressed audit
results in the workflow summary.

## Implementation

- Add `.github/workflows/audit-auto-prs.yml`.
- Reuse shared automation actions for branch prep, ZAI execution, duplicate
  detection, commit/push, PR body generation, PR upsert, and failure reporting.
- Update `.github/workflows/documentation.md` with secrets and workflow map
  coverage.
- Validate workflow syntax, governance policy, and formatting.
