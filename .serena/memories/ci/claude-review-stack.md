# Claude review CI stack

## Routing
- PR-review workflows (`code-review`, `deepseek-code-review`, `deepseek`, `claude`, `triage`) call a thin wrapper — `run-zai` (Z.AI) or `run-deepseek` (DeepSeek) → `run-claude-params` → pinned `anthropics/claude-code-action`.
- `run-claude-params` (`run-claude-params/action.yml`) is the shared composite owning `--allowedTools` resolution, model pin, turn budget, retries, and log scanning. All review-fixing happens here, not in the per-workflow files.
- `antigravity-code-review.yml` is a SEPARATE path — does NOT route through `run-claude-params`. Don't assume review-stack fixes apply there.

## Inline PR comments — two posting mechanisms
- `mcp__github_inline_comment__create_inline_comment` (claude-code-action's bundled MCP server): works ONLY on native triggers (`issue_comment` `/review`, `pull_request`, `pull_request_review*`). NOT initialized on `workflow_dispatch` — upstream claude-code-action issue #635. So orchestrated/dispatched reviews cannot use it.
- `post-pr-inline-comment.sh` (allowlisted `gh` wrapper under `.github/workflows/scripts/`): posts OR upserts one inline comment via `gh api repos/{owner}/{repo}/pulls/{n}/comments`; works on ALL triggers incl. `workflow_dispatch`. Idempotent upsert by `(path, line)`, scoped to its own comments via a hidden ownership marker; never clobbers human/other-bot comments. Gated by the `allow-post-inline` input (opt-in on the review workflows), which also injects a one-line how-to into the task prompt.
- The guard in `run-claude-params` (`resolve_allowed_tools`) keeps the MCP tool only when there is PR context (derived from `github.event.pull_request.number || inputs.pr_number || (issue.pull_request && issue.number)`), so it is not offered on cron / issue-only runs.

## Invariant
Inline-comment tooling MUST stay trigger-agnostic: never rely on the MCP tool alone — anything dispatched via `workflow_dispatch` needs the helper. See `mem:ci/testing-and-validation` for how to validate workflow/action edits.
