# Core index

Amnezia Control Panel — Next.js 15 + React 19 + TypeScript + Prisma/SQLite + Socket.io. Single-admin panel managing Amnezia AWG + 3x-ui on shared VPN servers (1–3 servers, ≤50 users). Self-hosted, single-server deployment.

## Domains
- CI / GitHub Actions automation:
  - `mem:ci/claude-review-stack` — Claude review workflow routing (run-zai/run-deepseek → run-claude-params → claude-code-action), inline-comment posting (MCP tool vs allowlisted `gh` helper), the `workflow_dispatch` MCP-server gap (upstream #635).
  - `mem:ci/testing-and-validation` — `actionlint`, static-regex workflow tests, the prisma-generate false-failure in fresh worktrees, pre-commit lint/Prettier, scout-block grep gotcha.
- Tooling / environment:
  - `mem:env/serena-config` — Serena project registry (`~/.serena/serena_config.yml`); stale worktree paths break activation; server caches the list at startup.
