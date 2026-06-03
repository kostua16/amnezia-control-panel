# Workflow Configuration Reference

Setup guide for installing this repository's GitHub workflow stack on a new repo.

## Required Secrets

Settings -> Secrets and variables -> Actions -> **New repository secret**

| Secret             | Used by                                                                                                                                                                                     | Description                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ZAI_API_KEY`      | `claude`, `triage`, `code-review`, `dependency-review`, `release-notes`, `maintenance`, `fix-pr`, `fix-branch`, `pr-improve`, `workflow-health-optimize`                                    | API key for the Claude-compatible coding workflows (Z.AI provider)                                                                                              |
| `GEMINI_API_KEY`   | `antigravity`, `antigravity-code-review`                                                                                                                                                    | API key for the Antigravity CLI agent workflows                                                                                                                 |
| `AV_API_KEY`       | `antigravity`, `antigravity-code-review`                                                                                                                                                    | Alternative API key for the Antigravity CLI agent workflows                                                                                                     |
| `DEEPSEEK_API_KEY` | `deepseek`, `deepseek-code-review`                                                                                                                                                          | API key for DeepSeek coding workflows (Anthropic-compatible endpoint). Optional — workflows skip gracefully when not set.                                       |
| `GH_PAT`           | `triage`, `fix-issue`, `issue-catch-up`, `fix-pr`, `fix-branch`, `workflow-health-optimize`, `pr-improve`, `audit-fix`, `suggest-improvements`, `docs-drift`, `maintenance`, `_auto-fix-ci` | Push-capable Personal Access Token used when a workflow must push branches, create PRs, or create automation artifacts that should trigger downstream workflows |

`GITHUB_TOKEN` is automatic and is sufficient for read/comment/approve operations that do not need recursive workflow triggering.

## Why `GH_PAT` still exists

This repo intentionally keeps `GH_PAT` for the workflows that create commits, branches, or PRs and rely on downstream workflows to run afterward. Pushes and PR mutations performed with the default `GITHUB_TOKEN` do not reliably trigger the downstream workflow chain this repo depends on.

Use `GITHUB_TOKEN` for:

- `pr-flow` orchestration and worker dispatch
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
  -> pr-flow.yml (wakes orchestrator after CI settles)

pr-flow-watchdog.yml
  -> scheduled/manual stale-state recovery
  -> dispatches pr-flow.yml for open non-draft PRs still labeled flow/draft

pull_request_target lifecycle events
  -> pr-flow.yml
  -> reads .github/pr-flow.json, classifies the PR, syncs one flow/* state label, and dispatches one next worker
  -> publishes commit statuses on the PR head SHA for pr-flow/ready and worker visibility
  -> upserts one PR Flow Orchestration comment with worker links and latest decisions
  -> treats draft-to-ready as orchestration only; CI reruns require a new commit

code-review.yml
  -> dispatch-only worker controlled by pr-flow.yml
  -> /review issue comments remain a manual override
  -> issue-only comments are named Issue #... and skipped before setup
  -> produces ai-review-passed / ai-review-concerns
  -> produces security-review-passed / security-review-concerns
  -> pr-flow.yml consumes those signals

deepseek.yml
  -> standalone @deepseek trigger (issue_comment, PR review, issues)
  -> same trigger pattern as claude.yml but with @deepseek mention
  -> uses run-deepseek action with DEEPSEEK_API_KEY
  -> skips gracefully when DEEPSEEK_API_KEY secret is not set

deepseek-code-review.yml
  -> standalone non-blocking code review via /deepseek-review comment or workflow_dispatch
  -> single-phase review (no separate security phase)
  -> produces deepseek-review-passed / deepseek-review-concerns (non-blocking labels)
  -> NOT integrated into pr-flow.yml — runs independently
  -> skips gracefully when DEEPSEEK_API_KEY secret is not set

dependency-review.yml
  -> dispatch-only worker controlled by pr-flow.yml
  -> produces deps-review-passed / deps-review-manual / deps-review-blocked
  -> pr-flow.yml consumes those signals for Dependabot PRs

antigravity.yml
  -> interactive issue/PR comment handler using Antigravity CLI
  -> triggered by @gemini or @antigravity mentions

antigravity-code-review.yml
  -> dispatch-only worker or manual PR review using Antigravity CLI
  -> produces antigravity-review-passed / antigravity-review-concerns

pr-improve.yml
  -> dispatch-only worker controlled by pr-flow.yml
  -> creates or updates claude-planning-pr-<pr-number> draft PRs
  -> updates ROADMAP.md intake and source-PR namespaced quick artifacts

pr-finalizer.yml
  -> dispatch-only worker controlled by pr-flow.yml
  -> revalidates required checks, review labels, policy, and head SHA
  -> approves and enables auto-merge only for eligible trusted PRs
```

## PR Flow Visibility

`pr-flow/ready` is the only PR-flow status context that should be required in
branch protection or repository rulesets. The per-worker contexts are visible
diagnostics: `pr-flow/code-review`, `pr-flow/security-review`,
`pr-flow/dependency-review`, `pr-flow/pr-improve`, and `pr-flow/finalizer`.

Dispatch-only workers run through `workflow_dispatch`. GitHub associates a
`workflow_dispatch` run with the dispatched ref, which is normally `main` here,
not with the PR head commit. That means dispatched worker runs do not naturally
appear as native PR checks for the head SHA. `pr-flow.yml` bridges that gap by
writing commit statuses directly to the PR head SHA and by updating the sticky
`<!-- pr-flow-orchestration -->` PR comment.

The worker run-name contract is part of the orchestration API: worker run names
must include `PR #<number> @ <head_sha>`. `orchestrate-pr-flow.cjs` uses that
pattern to match active or completed dispatch runs back to the current PR head
and to avoid double dispatching stale workers.

Branch protection setup is external repository state. After the first
orchestrator run creates `pr-flow/ready`, require exactly that context if PR-flow
completion should block merges.

Manual-review markers such as `needs-review` intentionally complete
`pr-flow/ready` with success once CI is green. They prevent auto-finalization,
but they should not make the required aggregate status impossible to satisfy.
Hard blockers such as `do-not-merge`, AI/security concern labels, and blocked
dependency labels still fail `pr-flow/ready`.

## Policy Labels

The following labels are enforced or created automatically by the workflow stack:

| Label                         | Purpose                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `ai-review-passed`            | Main AI review found no blocking issues                 |
| `ai-review-concerns`          | Main AI review found blocking issues                    |
| `security-review-passed`      | Security review found no significant issues             |
| `security-review-concerns`    | Security review found significant issues                |
| `deepseek-review-passed`      | DeepSeek code review found no issues (non-blocking)     |
| `deepseek-review-concerns`    | DeepSeek code review found concerns (non-blocking)      |
| `deps-review-passed`          | Dependabot PR remains auto-merge eligible               |
| `deps-review-manual`          | Dependency PR needs manual review                       |
| `deps-review-blocked`         | Dependency PR is blocked from auto-merge                |
| `skip-improve`                | Skip the Claude+GSD improvement analysis flow           |
| `planning-draft-open`         | A draft planning PR exists for follow-up work           |
| `flow/draft`                  | PR flow is paused while the PR is draft                 |
| `flow/checks-pending`         | PR flow is waiting for required PR checks               |
| `flow/checks-failed`          | PR flow is blocked by failed required PR checks         |
| `flow/checks-unavailable`     | PR flow could not read completed required PR checks     |
| `flow/review-pending`         | PR flow is waiting for review automation                |
| `flow/review-blocked`         | PR flow is blocked by review or policy labels           |
| `flow/review-failed`          | PR flow review automation failed                        |
| `flow/improve-pending`        | PR flow is waiting for improvement intake               |
| `flow/improve-failed`         | PR flow improvement intake failed                       |
| `flow/finalizer-dispatched`   | PR flow dispatched the finalizer for this PR head       |
| `flow/manual-only`            | PR flow reached a manual-only orchestration path        |
| `do-not-merge`                | Explicitly block finalizer approval and auto-merge      |
| `auto-fix-approved`           | Maintainer explicitly approved issue auto-fix execution |
| `antigravity-review-passed`   | Antigravity AI code review found no blocking issues     |
| `antigravity-review-concerns` | Antigravity AI code review found blocking concerns      |

Existing operational labels still used by the repo include `auto-fix`, `needs-review`, `triaged`, `duplicate`, `fixed`, `canceled`, and `ci-failure`.

## Trusted Branches

Auto-finalization candidates:

- `claude-auto-fix-ci-*`
- `claude-fix-issue-*`
- `claude-audit-safe-fix-*` when the diff stays within the audit-safe limits and review signals pass
- `dependabot/npm*` and `dependabot/npm_and_yarn/*` when the update is proven to be patch/minor and dependency review passes

Always manual-only:

- `claude-workflow-optimize-*`
- `claude-audit-fix-*`
- `claude-planning-pr-*`
- any PR touching `.github/**`
- any PR touching `.planning/**`
- any audit-fix PR touching API routes, auth, sync, API key, panel/server/user config, Prisma/generated code, package manifests, scripts, or more than the audit-safe size limits
- any Dependabot GitHub Actions update
- any dependency PR labeled `deps-review-manual` or `deps-review-blocked`

## Policy Examples

| PR shape                                                                                                                                           | Result                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `claude-auto-fix-ci-main-12345` touching `src/**`, green checks, `ai-review-passed`, `security-review-passed`                                      | Finalizer approves and enables squash auto-merge                                |
| `claude-auto-fix-ci-main-12345` touching `.github/workflows/ci.yml`                                                                                | Finalizer leaves it manual-only                                                 |
| `claude-fix-issue-*` missing `security-review-passed`                                                                                              | Finalizer waits for review signals                                              |
| `claude-audit-safe-fix-*` touching a small component/hook/resource-monitor diff, green checks, `ai-review-passed`, `security-review-passed`        | Finalizer approves and enables squash auto-merge                                |
| `claude-audit-safe-fix-*` touching `src/app/api/**`, auth/sync/config paths, Prisma, packages, workflows, or more than 3 files / 120 changed lines | Finalizer leaves it manual-only                                                 |
| `claude-audit-fix-*` from a broad autonomous audit                                                                                                 | Finalizer leaves it manual-only                                                 |
| Broad audit fix touching API route + seed/security-sensitive paths and 7+ files                                                                    | Finalizer leaves it manual-only                                                 |
| `dependabot/npm_and_yarn/react-*` with patch/minor update and `deps-review-passed`                                                                 | Finalizer approves and enables squash auto-merge                                |
| `dependabot/github_actions/actions-checkout-*`                                                                                                     | Finalizer leaves it manual-only                                                 |
| Any PR with `do-not-merge` or a concern/block label                                                                                                | Finalizer does not approve or enable auto-merge                                 |
| Any PR with only `needs-review` after CI passes                                                                                                    | PR flow marks manual-only complete; human review remains outside PR-flow status |

## Composite Action Notes

`setup-environment`:

- installs or reuses GitHub CLI through `kostua16/setup-gh@v1.0.2`
- switches later `gh` commands to the provided `github-token`, so callers can move between `GITHUB_TOKEN` bot/comment identity and `GH_PAT` commit/PR/workflow-trigger identity
- skips GSD install when `.claude/gsd-install-state.json` is present
- falls back to pinned `@opengsd/get-shit-done-redux` version `1.1.0` only if that file is missing
- installs pinned RTK version `0.35.0`

`run-zai`:

- accepts `github-token` (default `GITHUB_TOKEN`) and passes it to `run-claude-params`
- exposes Claude health and metrics outputs, including `claude_failed`, `claude_failure_reason`, `claude_num_turns`, `claude_is_error`, `claude_used_attempt`, `claude_has_findings`, `claude_failed_tool_samples`, and `claude_metrics_json`
- accepts `claude-full-output`; it defaults to `true` in this private repo but should default to `false` before public reusable workflow extraction
- modify-capable workflows pass `github-token: ${{ secrets.GH_PAT }}`; read-only workflows use the default
- workflows or jobs using `run-zai`/`run-claude` must grant at least `actions: read`; existing `actions: write` flows already satisfy this for CI-status MCP support
- orchestrator-dispatched `workflow_dispatch` workers run as `github-actions[bot]`, so Claude/ZAI steps must pass `allowed-bots: github-actions,github-actions[bot],claude[bot]` when `orchestrated=true`; do not use wildcard bot allowance

`run-deepseek`:

- same pattern as `run-zai` but routes to `https://api.deepseek.com/anthropic` (DeepSeek's Anthropic-compatible endpoint)
- model defaults: haiku→`deepseek-v4-flash`, sonnet→`deepseek-v4-pro[1m]`, opus→`deepseek-v4-pro[1m]`
- always sets `CLAUDE_CODE_EFFORT_LEVEL=max` for maximum reasoning depth
- accepts `github-token` (default `GITHUB_TOKEN`) and passes it to `run-claude-params`
- exposes the same Claude health and metrics outputs as `run-zai`
- workflows or jobs using `run-deepseek` must grant at least `actions: read`

`run-claude-params`:

- single source of truth for Claude health normalization
- emits normalized outputs based on structured execution-file parsing first, then sanitized log fallback
- includes capped failed-tool samples in `claude_metrics_json` so issues show the concrete denied or failing commands behind failed-tool counts
- tracks the last attempted Claude run separately from the last successful run so failed attempts still produce useful diagnostics
- decision chain: no attempt → hard failure with action error → missing output → turn limit + error → is_error → 0 turns → error-severity log findings

`report-failure`:

- accepts `github-token` (default `GITHUB_TOKEN`) for label, issue/comment, and triage dispatch operations
- accepts optional Claude metadata, failed-tool samples, and `claude_metrics_json` inputs rendered in a compact `### Claude Execution` section
- parses failed job logs as a fallback so matrix jobs can still surface Claude action errors and sanitized SDK context
- uses resolved labels from the internal `Resolve labels` step to prevent drift

`upsert-pull-request`:

- captures stderr on labeled creation attempts, retries without labels on failure
- exits non-zero with `::error::` if PR creation fails with and without labels
- null-checks post-create query to prevent silent `null` outputs

`commit-and-push`:

- relies on checkout's retained auth for push; no `token` input needed

`google-github-actions/run-gemini-cli@v0`:

- external action that runs the Gemini CLI (Antigravity) natively
- requires `GEMINI_CLI_TRUST_WORKSPACE: 'true'` for autonomous workspace access

## Dry-Run Entry Points

The following workflows expose `workflow_dispatch` dry-run inputs for safe testing:

- `pr-flow.yml`
- `pr-flow-watchdog.yml`
- `pr-finalizer.yml`
- `pr-improve.yml`
- `issue-catch-up.yml`

`pr-flow.yml` uses `.github/pr-flow.json` for worker order, required checks, reset labels, and managed `flow/*` labels. Routine runs do not recreate labels; pass `--ensure-labels true` to `.github/workflows/scripts/orchestrate-pr-flow.cjs` only for one-time label setup or repair.

If a PR is no longer draft but remains stuck on `flow/draft`, run:

```bash
gh workflow run pr-flow.yml --ref main -f pr_number=<PR> -f dry_run=false
```

`pr-flow-watchdog.yml` runs every 15 minutes away from the top of the hour and performs the same recovery automatically for open non-draft PRs that still have `flow/draft`.

## GSD Slash Command Format

All GSD slash commands in workflow prompts **must** use the colon namespace format (`/gsd:xxx`), not the hyphenated form (`/gsd-xxx`). Claude Code's CLI parser only recognizes `/gsd:xxx` as a valid skill invocation. The hyphenated form is a display alias that the local skill router resolves interactively but the CLI rejects when used as the first token in a prompt — the entire run fails with `Unknown command` at turn 0.

| Use           | Avoid         |
| ------------- | ------------- |
| `/gsd:health` | `/gsd-health` |
| `/gsd:debug`  | `/gsd-debug`  |
| `/gsd:quick`  | `/gsd-quick`  |

## Syntax Gate

`actionlint` should remain the mandatory syntax check after any workflow edit. Run it before merging workflow changes.
