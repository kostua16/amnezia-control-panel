# Workflow Configuration Reference

Setup guide for installing all CI/CD workflows on a new repository.

## Required Secrets

Settings → Secrets and variables → Actions → **New repository secret**

| Secret | Used by | Description |
|--------|---------|-------------|
| `ZAI_API_KEY` | claude, triage, code-review, dependency-review, release-notes, maintenance, fix-pr, ci-failure-auto-fix-branch, ci-failure-auto-fix-pr, workflow-health-optimize | Anthropic API key for Claude Code Action |
| `GH_PAT` | fix-pr, ci-failure-auto-fix-branch, ci-failure-auto-fix-pr, workflow-health-optimize | Personal Access Token for checkout + push (GITHUB_TOKEN lacks push permissions). Classic: `repo` scope. Fine-grained: Contents (r/w), Pull requests (r/w), Issues (r/w) |

`GITHUB_TOKEN` is automatic — no setup needed. Used by workflows that only read/comment (ci, perf-check, pr-size-guard, stale, triage, release-notes).

## Required Variables

Settings → Secrets and variables → Actions → **Variables** tab

| Variable | Used by | Example | Description |
|----------|---------|---------|-------------|
| `ANTHROPIC_BASE_URL` | all Claude workflows | `https://api.anthropic.com` | API base URL (change for proxies/bedrock) |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | triage, dependency-review, release-notes, maintenance, code-review | `claude-haiku-4-5-20251001` | Model for lightweight tasks |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | claude, fix-pr, ci-failure-auto-fix-branch, ci-failure-auto-fix-pr, workflow-health-optimize, maintenance, code-review | `claude-sonnet-4-20250514` | Model for coding/fix tasks |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | code-review | `claude-opus-4-20250514` | Model for deep review |
| `CLAUDE_CODE_SUBAGENT_MODEL` | claude, triage, fix-pr, maintenance, ci-failure-auto-fix-branch, ci-failure-auto-fix-pr, workflow-health-optimize, code-review | `claude-haiku-4-5-20251001` | Model for subagents |
| `API_TIMEOUT_MS` | claude, triage, fix-pr, maintenance, ci-failure-auto-fix-branch, ci-failure-auto-fix-pr, workflow-health-optimize, code-review | `120000` | API call timeout in ms |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | claude, triage, fix-pr, maintenance, ci-failure-auto-fix-branch, ci-failure-auto-fix-pr, workflow-health-optimize, code-review | `1` | Disables telemetry |
| `CLAUDE_DEBUG` | all Claude workflows | `false` | Set `true` for verbose output |

## Workflow Dependency Map

```
ci.yml ──► ci-failure-auto-fix-branch.yml  (on failure, direct push to main/develop)
       ──► ci-failure-auto-fix-pr.yml       (on failure, PR exists)

issues:opened ──► triage.yml ──► fix-pr.yml        (on /fix command or triaged label)

schedule ──► workflow-health-optimize.yml           (hourly)

PR events ──► code-review.yml, pr-size-guard.yml, dependency-review.yml, perf-check.yml

schedule ──► stale.yml, maintenance.yml, release-notes.yml
```

## Required Labels

These labels are auto-created by workflows at runtime, so no manual setup is needed:

`auto-fix`, `needs-review`, `ci-failure`, `triaged`, `enhancement`, `bug`, `question`, `documentation`, `good first issue`, `help wanted`, `stale`

## Composite Action

`setup-environment` (`.github/actions/setup-environment/`) — shared Node.js + deps + GSD setup. No secrets required; called with `with:` inputs by all Claude workflows.

## Minimal Setup Checklist

1. Create `ZAI_API_KEY` secret
2. Create `GH_PAT` secret (for push-capable workflows)
3. Set all 8 variables listed above
4. Copy `.github/workflows/*.yml`, `.github/actions/setup-environment/`, and `.claude/` (for GSD)
5. Enable GitHub Actions in repo settings
