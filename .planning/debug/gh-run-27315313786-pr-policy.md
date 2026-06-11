---
status: resolved
trigger: "investigate and fix via new PR the gh run#27315313786"
created: 2026-06-11
updated: 2026-06-11
---

## Symptoms
- **Expected behavior**: PR Policy should label and validate pull_request_target PRs.
- **Actual behavior**: Run 27315313786 failed in PR Policy job `label-and-validate`.
- **Error messages**: `Resource not accessible by integration` while adding labels to PR #292.
- **Timeline**: Observed on 2026-06-11 for PR #292, branch `claude-audit-fix-27312545087`.
- **Reproduction**: Run PR Policy on PR #292 head `311347976c03ee89c2174080f904638c3e19c76d`.

## Evidence
- **timestamp**: 2026-06-11T00:26:58Z
  - Workflow run: https://github.com/kostua16/amnezia-control-panel/actions/runs/27315313786
  - Job: `label-and-validate`
  - Failing step: `Apply PR labels and policy status`
  - API call: `POST https://api.github.com/repos/kostua16/amnezia-control-panel/issues/292/labels`
  - Error: `403 Resource not accessible by integration`
  - Run token permissions showed `Issues: write`, `PullRequests: read`, `Statuses: write`.
  - GitHub response included `x-accepted-github-permissions: issues=write; pull_requests=write`.
- **timestamp**: 2026-06-11
  - Targeted PR flow invariant test passed.
  - ESLint passed.
  - Targeted Prettier check passed.
  - Full `src/lib/__tests__/*.test.ts` suite passed after generating the ignored Prisma client.

## Resolution
root_cause: "PR Policy mutates pull request labels from a pull_request_target workflow, but the workflow only granted pull-requests: read. GitHub required pull_requests=write for the label mutation path in this run."
fix: "Grant pull-requests: write in .github/workflows/pr-policy.yml and add a regression invariant for the PR Policy permissions."
verification: "PR flow invariant test, lint, targeted Prettier check, and full unit test suite passed locally; rerun PR Policy after merge."
files_changed: ".github/workflows/pr-policy.yml, src/lib/__tests__/pr-flow-watchdog.test.ts"
