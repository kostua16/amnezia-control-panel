# Workflow Inventory & Reference

## Workflows (15)

| Workflow | File | Triggers | Claude? | Action | Model | track_progress | Timeout | MAX_TURNS |
|---|---|---|---|---|---|---|---|---|
| CI | ci.yml | push(main), PR | No | N/A | N/A | N/A | 10-15m | N/A |
| Claude Code | claude.yml | issue_comment, PR review comment, issues, PR review | Yes | run-zai | sonnet | true | 30m | 100 |
| Code Review | code-review.yml | PR, issue_comment, PR review comment | Yes | run-zai | sonnet + opus (security) | true | 20m | 100 |
| Fix Issue | fix-issue.yml | issue_comment(/fix), issues(labeled:triaged) | Yes | run-zai | sonnet | true | 20m | 100 |
| Fix PR | fix-pr.yml | workflow_run(CI, failure) w/ PRs | Yes | run-zai | sonnet | false | 20m | 70 |
| Fix Branch | fix-branch.yml | workflow_run(CI, failure) no PRs | Yes | run-zai | sonnet | false | 20m | 70 |
| Issue Triage | triage.yml | issues, issue_comment(/triage), workflow_dispatch | Yes | run-zai | haiku | conditional | 15m | 80 |
| Issue Catch-Up | issue-catch-up.yml | schedule(hourly :30), workflow_dispatch | Yes | run-zai | haiku | false | 10-30m | 50 |
| Workflow Health | workflow-health-optimize.yml | schedule(hourly :00), workflow_dispatch | Yes | run-zai | sonnet | false | 10-20m | 25 |
| Daily Maintenance | maintenance.yml | schedule(2x daily), workflow_dispatch | Yes | run-zai | sonnet | false | 30m | 100 |
| Stale Issues | stale.yml | schedule(weekly), workflow_dispatch | No | N/A | N/A | N/A | N/A | N/A |
| Release Notes | release-notes.yml | push(tags v*) | Yes | run-zai | haiku | false | 10m | 80 |
| Perf Check | perf-check.yml | PR(paths: src, pkg) | No | N/A | N/A | N/A | 20m | N/A |
| PR Size Guard | pr-size-guard.yml | PR(opened, synchronize) | No | N/A | N/A | N/A | 2m | N/A |
| Dependency Review | dependency-review.yml | PR(paths: pkg files), dependabot only | Yes | run-zai | haiku | true | 15m | 80 |

## Composite Actions (7)

| Action | Purpose | Key Inputs |
|---|---|---|
| setup-environment | Node.js setup, npm ci, prisma generate, GSD install, RTK install | node-version, install-deps, generate-prisma, install-gsd, install-rtk |
| run-claude-params | Base: claude-code-action with turn budget calc, 429-gated 3x retry, model alias resolution | all params explicit (api-key, api-url, model, haiku-model, sonnet-model, opus-model, etc.) |
| run-claude | Thin wrapper: Anthropic defaults (api-url: anthropic.com, claude-* models) | api-key, prompt, model |
| run-zai | Thin wrapper: ZAI proxy defaults (api-url: z.ai, glm-* models) | api-key, prompt, model, haiku-model, sonnet-model, opus-model |
| commit-and-push | git add + commit + push with 3x retry (5s backoff) | branch-name, commit-message, token |
| report-failure | Collect failure logs → create issue or comment | mode, issue-number, auto-fix-run-url |
| prettier-auto-fix | Detect prettier-only lint failures → apply without AI | run-id, github-token |

## Helper Scripts (3)

- **scripts/gh.sh** — safe gh wrapper (issue view/list, search issues, label list). Validates repo format, blocks `repo:`/`org:`/`user:` qualifiers.
- **scripts/edit-issue-labels.sh** — label editor reading issue from `$GITHUB_EVENT_PATH`. Only `--add-label`/`--remove-label`, validates labels exist.
- **scripts/analyze-claude-runs.sh** — bulk-analyze completed CI runs for Claude failure patterns. Categorizes 11 error types + uncategorized fallback. Options: `--limit N` (default 50), `--json` (structured output). Requires `gh` CLI + `jq`. Bash 3.2 compatible.

## Architecture Patterns

### Action Chain
```
workflows → run-zai (or run-claude) → run-claude-params → anthropics/claude-code-action@v1
```

### 429 Retry (in run-claude-params)
On failure, probes API with minimal request. Only retries on HTTP 429 (rate limit). 3 attempts total, 2-min wait between retries. Non-429 failures skip retries.

### Turn Budget (in run-claude-params)
Calculates 80/20/20 split from MAX_TURNS and appends to prompt:
- `budget = MAX_TURNS * 80%`
- `investigate = budget * 20%`
- `main = budget * 60%`
- `verify = budget * 20%`

### Model Resolution (in run-claude-params)
Maps aliases → actual model IDs per wrapper:
- **run-zai**: haiku→glm-4.7, sonnet→glm-5, opus→glm-5.2
- **run-claude**: haiku→claude-haiku-4-5-20251001, sonnet→claude-sonnet-4-5-20250929, opus→claude-opus-4-5-20251101

### Prettier Shortcut
fix-pr/fix-branch use `prettier-auto-fix` action to detect prettier-only lint failures and apply mechanically — no AI cost.

### Fixability Gating
fix-pr/fix-branch classify failures as transient/unfixable/fixable. Only fixable failures invoke Claude. Transient (e.g. network) and unfixable (e.g. missing secret) are skipped.

### Git Auth Fix
claude-code-action invalidates checkout auth header. `commit-and-push` re-sets it with `base64 -w 0`.

### Infinite Loop Prevention
- fix-issue: labels `canceled` when no changes made
- fix-pr: avoids `/fix` mention in no-changes comment
- fix-branch: `!startsWith(branch, 'claude-auto-fix-ci-')` prevents self-triggering

### track_progress Compatibility
```
COMPATIBLE (track_progress: true is OK):
  pull_request, issues, issue_comment,
  pull_request_review_comment, pull_request_review

INCOMPATIBLE (MUST be false or conditional):
  workflow_dispatch, workflow_run, push, schedule, registry_package
```

### Other Patterns
- **GITHUB_TOKEN issue creation**: issues opened by GITHUB_TOKEN don't fire events → workflows manually dispatch triage.yml
- **Triaged label hard-gate**: triage.yml only adds `triaged` label after verifying triage comment exists
- **Error log truncation**: report-failure truncates job logs to last 3000 chars per job
- **Bot actor**: workflows triggered by other workflows run as `github-actions[bot]` — must add `allowed_bots`

## Secrets

| Name | Type | Used By |
|---|---|---|
| ZAI_API_KEY | secret | All Claude workflows (via run-zai) |
| GH_PAT | secret | fix-issue, fix-pr, fix-branch, workflow-health-optimize, issue-catch-up, triage (checkout, push, cross-workflow triggers) |
| GITHUB_TOKEN | auto | All workflows (default) |

## Env Vars (workflow-level convention)

```yaml
env:
  MAX_TURNS: "<varies by workflow>"
  NODE_VERSION: "22.x"
```

No `vars.ANTHROPIC_*` — all model config baked into run-zai/run-claude-params.
