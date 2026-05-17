# Workflow Inventory & Reference

## Current Workflows

| Workflow | File | Triggers | Uses Claude | track_progress |
|----------|------|----------|-------------|----------------|
| CI | `ci.yml` | `push(main)`, `pull_request` | No | N/A |
| Claude Code | `claude.yml` | `issue_comment`, `pull_request_review_comment`, `issues`, `pull_request_review` | Yes | `true` (all compatible) |
| Code Review | `code-review.yml` | `pull_request`, `issue_comment`, `pull_request_review_comment` | Yes | `true` (all compatible) |
| Issue Triage | `triage.yml` | `issues`, `issue_comment`, `workflow_dispatch` | Yes | conditional |
| Auto Fix CI (PR) | `ci-failure-auto-fix-pr.yml` | `workflow_run(CI)` | Yes | `false` |
| Auto Fix CI (Branch) | `ci-failure-auto-fix-branch.yml` | `workflow_run(CI)` | Yes | `false` |
| Daily Maintenance | `maintenance.yml` | `schedule(cron)`, `workflow_dispatch` | Yes | `false` (both triggers incompatible) |
| Stale Issues | `stale.yml` | `schedule(cron)`, `workflow_dispatch` | No | N/A |
| Release Notes | `release-notes.yml` | `push(tags v*)` | Yes | `false` (`push` incompatible) |
| Perf Check | `perf-check.yml` | `pull_request(paths)` | No | N/A |
| PR Size Guard | `pr-size-guard.yml` | `pull_request` | No | N/A |
| Dependency Review | `dependency-review.yml` | `pull_request(paths)` | Yes | `true` (compatible) |

## Known Issues / Gotchas

### track_progress Incompatibility
`anthropics/claude-code-action@v1` only supports `track_progress` for:
- `pull_request`, `issues`, `issue_comment`, `pull_request_review_comment`, `pull_request_review`

**Fixed:**
- `triage.yml:63` — conditional: `${{ github.event_name != 'workflow_dispatch' }}`
- `ci-failure-auto-fix-pr.yml:138` — `false` (only `workflow_run`)
- `ci-failure-auto-fix-branch.yml:128` — `false` (only `workflow_run`)
- `maintenance.yml:45` — `false` (`schedule` and `workflow_dispatch` both incompatible)
- `release-notes.yml:44` — `false` (`push` incompatible)

### GITHUB_TOKEN Issue Creation
Issues opened by `GITHUB_TOKEN` do NOT fire `issues:opened` events. The auto-fix workflows manually dispatch `triage.yml` via `workflow_dispatch` to work around this.

### Auto-fix Branch Naming
Auto-fix branches use the pattern `claude-auto-fix-ci-{sanitized-branch}-{run-id}`. The `!startsWith` check in `if` prevents infinite loops.

### Concurrency Groups
Most Claude-using workflows use issue/PR-numbered concurrency groups to prevent parallel runs on the same issue. `cancel-in-progress: true` for most; `false` for `claude.yml` (to avoid killing in-progress Claude sessions).

## Composite Actions

### `.github/actions/setup-environment`
Shared setup action with inputs:
- `node-version` (default: `"22.x"`) — Node.js version
- `install-deps` (default: `"false"`) — Run `npm ci` with npm cache
- `generate-prisma` (default: `"false"`) — Run `npx prisma generate`
- `install-gsd` (default: `"false"`) — Install GSD framework with cache

## Helper Scripts

### `.github/workflows/scripts/gh.sh`
Safe `gh` CLI wrapper. Only allows: `issue view`, `issue list`, `search issues`, `label list`.
Validates repo format, blocks `repo:`/`org:`/`user:` qualifiers in search.

### `.github/workflows/scripts/edit-issue-labels.sh`
Label editor for triage. Reads issue number from `$GITHUB_EVENT_PATH`. Only accepts `--add-label` and `--remove-label`. Validates labels exist in repo before applying.

## Shared Environment Variables

All Claude-using workflows define these env vars at workflow level:
```yaml
env:
  MAX_TURNS: "300"
  NODE_VERSION: "22.x"
  DISABLE_TELEMETRY: "1"
  API_TIMEOUT_MS: "${{ vars.API_TIMEOUT_MS }}"
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "${{ vars.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC }}"
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "${{ vars.ANTHROPIC_DEFAULT_HAIKU_MODEL }}"
  ANTHROPIC_DEFAULT_SONNET_MODEL: "${{ vars.ANTHROPIC_DEFAULT_SONNET_MODEL }}"
  ANTHROPIC_DEFAULT_OPUS_MODEL: "${{ vars.ANTHROPIC_DEFAULT_OPUS_MODEL }}"
  CLAUDE_CODE_SUBAGENT_MODEL: "${{ vars.CLAUDE_CODE_SUBAGENT_MODEL }}"
  ANTHROPIC_BASE_URL: "${{ vars.ANTHROPIC_BASE_URL }}"
```

## Secrets & Variables Required

| Name | Type | Used By |
|------|------|---------|
| `ZAI_API_KEY` | secret | All Claude workflows (`anthropic_api_key`, `settings.env`) |
| `GITHUB_TOKEN` | auto | Auto-fix workflows (checkout, push, PR creation) |
| `API_TIMEOUT_MS` | var | All Claude workflows |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | var | All Claude workflows |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | var | Triage, maintenance, release notes, dependency review |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | var | Code review, auto-fix, claude.yml |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | var | Security review |
| `CLAUDE_CODE_SUBAGENT_MODEL` | var | All Claude workflows |
| `ANTHROPIC_BASE_URL` | var | All Claude workflows |

## Model Usage Patterns

| Workflow Purpose | Model | Why |
|------------------|-------|-----|
| Triage, maintenance, release notes, dep review | Haiku | Fast, cheap, simple classification/writing |
| Code review, auto-fix, general Claude | Sonnet | Balanced quality/cost |
| Security review | Opus | Highest quality for security analysis |
