# Workflow Configuration Reference

Setup guide for installing this repository's GitHub workflow stack on a new repo.

## Required Secrets

Settings -> Secrets and variables -> Actions -> **New repository secret**

| Secret | Used by | Description |
|--------|---------|-------------|
| `ZAI_API_KEY` | `claude`, `triage`, `code-review`, `dependency-review`, `release-notes`, `maintenance`, `fix-pr`, `fix-branch`, `pr-improve`, `workflow-health-optimize` | API key for the Claude-compatible coding workflows |
| `GH_PAT` | `triage`, `fix-issue`, `issue-catch-up`, `fix-pr`, `fix-branch`, `workflow-health-optimize`, `pr-improve`, `audit-fix`, `suggest-improvements`, `docs-drift`, `maintenance`, `_auto-fix-ci` | Push-capable Personal Access Token used when a workflow must push branches, create PRs, or create automation artifacts that should trigger downstream workflows |

`GITHUB_TOKEN` is automatic and is sufficient for read/comment/approve operations that do not need recursive workflow triggering.

## Why `GH_PAT` still exists

This repo intentionally keeps `GH_PAT` for the workflows that create commits, branches, or PRs and rely on downstream workflows to run afterward. Pushes and PR mutations performed with the default `GITHUB_TOKEN` do not reliably trigger the downstream workflow chain this repo depends on.

Use `GITHUB_TOKEN` for:
- `pr-finalizer`
- review-signal labeling
- release creation
- comments and lightweight metadata updates

Use `GH_PAT` for:
- automation-created branches and commits
- draft planning PR branches from `pr-improve`
- issue triage/fix flows that create or push automation artifacts

## Workflow Map

```text
CI
  -> fix-pr.yml (same-repo PR failure path)
  -> fix-branch.yml (direct push failure path)
  -> pr-finalizer.yml (re-evaluates trusted PRs after CI settles)

code-review.yml
  -> produces ai-review-passed / ai-review-concerns
  -> produces security-review-passed / security-review-concerns
  -> pr-finalizer.yml consumes those signals

dependency-review.yml
  -> produces deps-review-passed / deps-review-manual / deps-review-blocked
  -> pr-finalizer.yml consumes those signals for Dependabot PRs

pull_request_target / schedule
  -> pr-improve.yml
  -> creates or updates claude-planning-pr-<pr-number> draft PRs
  -> updates ROADMAP.md and 13.x planning intake artifacts
```

## Policy Labels

The following labels are enforced or created automatically by the workflow stack:

| Label | Purpose |
|------|---------|
| `ai-review-passed` | Main AI review found no blocking issues |
| `ai-review-concerns` | Main AI review found blocking issues |
| `security-review-passed` | Security review found no significant issues |
| `security-review-concerns` | Security review found significant issues |
| `deps-review-passed` | Dependabot PR remains auto-merge eligible |
| `deps-review-manual` | Dependency PR needs manual review |
| `deps-review-blocked` | Dependency PR is blocked from auto-merge |
| `skip-improve` | Skip the Claude+GSD improvement analysis flow |
| `planning-draft-open` | A draft planning PR exists for follow-up work |
| `do-not-merge` | Explicitly block finalizer approval and auto-merge |
| `auto-fix-approved` | Maintainer explicitly approved issue auto-fix execution |

Existing operational labels still used by the repo include `auto-fix`, `needs-review`, `triaged`, `duplicate`, `fixed`, `canceled`, and `ci-failure`.

## Trusted Branches

Auto-finalization candidates:
- `claude-auto-fix-ci-*`
- `claude-fix-issue-*`
- `dependabot/npm*` and `dependabot/npm_and_yarn/*` when the update is proven to be patch/minor and dependency review passes

Always manual-only:
- `claude-workflow-optimize-*`
- `claude-planning-pr-*`
- any PR touching `.github/**`
- any PR touching `.planning/**`
- any Dependabot GitHub Actions update
- any dependency PR labeled `deps-review-manual` or `deps-review-blocked`

## Policy Examples

| PR shape | Result |
|---------|--------|
| `claude-auto-fix-ci-main-12345` touching `src/**`, green checks, `ai-review-passed`, `security-review-passed` | Finalizer approves and enables squash auto-merge |
| `claude-auto-fix-ci-main-12345` touching `.github/workflows/ci.yml` | Finalizer leaves it manual-only |
| `claude-fix-issue-*` missing `security-review-passed` | Finalizer waits for review signals |
| `dependabot/npm_and_yarn/react-*` with patch/minor update and `deps-review-passed` | Finalizer approves and enables squash auto-merge |
| `dependabot/github_actions/actions-checkout-*` | Finalizer leaves it manual-only |
| Any PR with `do-not-merge` or a concern/block label | Finalizer does not approve or enable auto-merge |

## Composite Action Notes

`setup-environment`:
- skips GSD install when `.claude/gsd-install-state.json` is present
- falls back to pinned `@opengsd/get-shit-done-redux` version `1.1.0` only if that file is missing
- installs pinned RTK version `0.35.0`

`run-zai`:
- accepts `github-token` (default `GITHUB_TOKEN`) and passes it to `run-claude-params`
- exposes Claude health outputs: `claude_failed`, `claude_failure_reason`, `claude_num_turns`, `claude_is_error`, `claude_used_attempt`, `claude_has_findings`
- modify-capable workflows pass `github-token: ${{ secrets.GH_PAT }}`; read-only workflows use the default

`run-claude-params`:
- single source of truth for Claude health normalization
- emits normalized outputs based on execution file parsing and log scanner findings
- 7-priority decision chain: no attempt → hard failure → missing output → turn limit + error → is_error → 0 turns → error-severity log findings

`report-failure`:
- accepts `github-token` (default `GITHUB_TOKEN`) for label, issue/comment, and triage dispatch operations
- accepts optional Claude metadata inputs (`claude-step-outcome`, `claude-turns`, `claude-is-error`, `claude-used-attempt`, `claude-failure-reason`) rendered in a `### Claude Execution` section
- uses resolved labels from the internal `Resolve labels` step to prevent drift

`upsert-pull-request`:
- captures stderr on labeled creation attempts, retries without labels on failure
- exits non-zero with `::error::` if PR creation fails with and without labels
- null-checks post-create query to prevent silent `null` outputs

`commit-and-push`:
- relies on checkout's retained auth for push; no `token` input needed

## Dry-Run Entry Points

The following workflows expose `workflow_dispatch` dry-run inputs for safe testing:
- `pr-finalizer.yml`
- `pr-improve.yml`
- `issue-catch-up.yml`

## Syntax Gate

`actionlint` should remain the mandatory syntax check after any workflow edit. Run it before merging workflow changes.
