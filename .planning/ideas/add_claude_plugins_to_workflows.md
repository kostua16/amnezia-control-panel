# Main idea

## v1 [implemented]

### Claude Marketplaces

Two marketplaces registered wherever plugins are installed:

```
anthropics/claude-plugins-official   # hosts all @claude-plugins-official plugins
juliusbrussee/caveman              # hosts caveman@caveman
```

> **Note:** The original v1 draft listed `anthropics/skills` — that repo (Agent Skills) does
> **not** host the plugin marketplace entries. The correct marketplace for
> `@claude-plugins-official` plugins is `anthropics/claude-plugins-official`.

### Claude Plugins

Plugins installed per profile (not all plugins in all flows):

#### All profile flows (E + R + P)
- `context7@claude-plugins-official` — framework docs (Next.js 16 / Prisma)
- `serena@claude-plugins-official` — cross-file symbol graph, read-only tools only

#### Profile E (Engineer) — code-editing flows only
- `typescript-lsp@claude-plugins-official` — TS symbol + diagnostics
- `code-review@claude-plugins-official` — self-review
- `security-guidance@claude-plugins-official` — STRIDE/OWASP guidance
- `code-simplifier@claude-plugins-official` — cleanup
- `frontend-design@claude-plugins-official` — UI/design
- `superpowers@claude-plugins-official` — broad agentic skills
- `caveman@caveman` — community skill bundle
- `commit-commands@claude-plugins-official` — **claude.yml only** (interactive @claude)

#### Profile R (Reviewer) — review/inspect flows only
- `typescript-lsp@claude-plugins-official`
- `code-review@claude-plugins-official`
- `pr-review-toolkit@claude-plugins-official`
- `security-guidance@claude-plugins-official`
- `code-simplifier@claude-plugins-official`

#### Profile P (Planner) — planning/propose flows only
- `caveman@caveman`

### Excluded (intentional)
- `pyright-lsp` — repo is TypeScript-only; no Python app code edited by CI
- `claude-code-setup` — bootstraps Claude config; in CI it risks rewriting committed `.claude/settings.json`
- `commit-commands` — only in `claude.yml`; auto flows explicitly forbid committing

### Workflow profile mapping
| Profile | Workflows |
|---------|-----------|
| E (Engineer) | claude, fix-issue, _auto-fix-ci, audit-fix, gsd-planning-execute |
| R (Reviewer) | code-review, audit-auto-prs |
| P (Planner) | gsd-planning, suggest-improvements, pr-improve, docs-drift |
| O (Ops) | triage, release-notes, dependency-review, issue-catch-up, maintenance, workflow-health-optimize, monitor-* |

### Prerequisites
- `uv` (Python package runner) added to `setup-environment` via `install-uv: 'true'` for serena MCP
- Exact MCP tool prefixes (`mcp__plugin_serena_serena__*`, `mcp__plugin_context7_context7__*`, `mcp__plugin_typescript-lsp__*`) added to each profile flow's `allowed-tools`
- serena restricted to read-only tools; `execute_shell_command` and write tools never allowed
