---
phase: 999
plan: 999-001
status: complete
started: "2026-06-13T00:00:00Z"
updated: "2026-06-13T00:00:00Z"
---

# Summary: GitHub workflows audit and automation roadmap

## What was done

Conducted a comprehensive audit of all 39 workflow files and 14 composite actions against the planning artifact's five findings areas. Most recommendations were already implemented in prior iterations. Identified and fixed the remaining gap: `fix-branch.yml` lacked the explicit policy evaluation step that `fix-pr.yml` already had.

### Changes committed

1. **fix-branch.yml — trust gate hardening**: Replaced inline `if:` conditions on the `fix` job with a proper `evaluate` job that calls `evaluate-trigger-policy.cjs --mode fix-branch`. The new gate validates the triggering actor is a trusted maintainer or bot, the branch is in the allowed list (main/develop), and the triggering workflow actually failed. This mirrors the defense-in-depth pattern already used by fix-pr.yml.

2. **evaluate-trigger-policy.cjs — fix-branch mode**: Added a new `fix-branch` mode that extracts `workflow_run.actor` metadata and validates trust based on maintainer associations, bot detection, branch allow-list, and failure conclusion. Returns structured JSON with `should_run`, `reason`, and actor details for audit logging.

3. **workflow-governance-check.cjs — secrets:inherit audit**: Extended the governance validator to emit warnings for any job using `secrets: inherit`, ensuring maintainers review reusable workflow permission scopes. The check correctly identifies the two existing uses (fix-branch.yml and fix-pr.yml) as informational warnings.

### Already-verified items (no changes needed)

- **Trust gates**: claude.yml, fix-pr.yml, fix-issue.yml all have authorize/evaluate jobs with policy checks
- **Correctness**: commit-and-push fails hard on push failure, perf-check has `set -euo pipefail`, all AI prompts are scoped to achievable tool access
- **Supply chain**: All 6 external action references are SHA-pinned to 40-char commits; RTK has SHA-256 install verification; GSD uses version pinning
- **PR governance**: pr-finalizer.yml enforces review signals (ai-review-passed, security-review-passed), blocking labels, CI status, and maintainer approval before enabling auto-merge
- **Planning scope**: suggest-improvements.yml and pr-improve.yml are scoped to `.planning/**` only, never edit source code
- **Governance validation**: workflow-governance-check.cjs already validates SHA pinning, top-level permissions, and pull_request_target allow-list

## Key files

### key-files.modified
- `.github/workflows/fix-branch.yml` — Added evaluate job with policy check
- `.github/workflows/scripts/evaluate-trigger-policy.cjs` — Added fix-branch mode
- `.github/workflows/scripts/workflow-governance-check.cjs` — Added secrets:inherit audit

### key-files.verified-unchanged
- `.github/workflows/claude.yml` — Has authorize gate with evaluate-trigger-policy.cjs
- `.github/workflows/fix-pr.yml` — Has evaluate job with policy check
- `.github/workflows/fix-issue.yml` — Has authorize job with policy check
- `.github/actions/commit-and-push/action.yml` — Already fails hard on push failure
- `.github/workflows/perf-check.yml` — Already has set -euo pipefail
- `.github/workflows/dependency-review.yml` — Well-scoped prompt with local tools only
- `.github/workflows/release-notes.yml` — Well-scoped with JSON output
- `.github/workflows/code-review.yml` — Separated main review and security review
- `.github/workflows/triage.yml` — Uses GH_PAT for duplicate closure
- `.github/actions/setup-environment/action.yml` — All external actions SHA-pinned
- `.github/workflows/pr-finalizer.yml` — Comprehensive approval/merge policy
- `.github/workflows/pr-policy.yml` — Labels, conventional commit validation, needs-review
- `.github/workflows/pr-improve.yml` — Planning-only scope
- `.github/workflows/suggest-improvements.yml` — Planning-only scope
- `.github/workflows/workflow-governance.yml` — Validates SHA pinning and permissions

## Deviations

None — implementation stayed within the source artifact scope.

## Self-Check: PASSED

- All 39 workflows and 14 actions audited against the 5 findings areas
- 3 concrete changes made addressing the one remaining gap
- ESLint and Prettier pass on all changed files
- Workflow governance check passes with expected warnings
