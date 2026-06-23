# Core index

Amnezia Control Panel — Next.js 15 + React 19 + TypeScript + Prisma/SQLite + Socket.io. Single-admin panel managing Amnezia AWG + 3x-ui on shared VPN servers (1–3 servers, ≤50 users). Self-hosted, single-server deployment.

## Domains
- CI / GitHub Actions automation:
  - `mem:ci/claude-review-stack` — Claude review workflow routing (run-zai/run-deepseek → run-claude-params → claude-code-action), inline-comment posting (MCP tool vs allowlisted `gh` helper), the `workflow_dispatch` MCP-server gap (upstream #635).
  - `mem:ci/testing-and-validation` — `actionlint`, static-regex workflow tests, the prisma-generate false-failure in fresh worktrees, pre-commit lint/Prettier, scout-block grep gotcha, RTK-Prettier false-clean.
  - `mem:ci/auto-fix-automation-graph` — issue→fix pipeline is label-driven: triage (`issues:opened`) → fix-issue (`auto-fix-approved` label) → hourly catch-up buckets; autonomous `audit-fix`/`audit-auto-prs` fix vulns independent of issues; `scan-claude-logs` fatal-finding gate; `edit-issue-labels.sh` silently drops unknown labels.
  - `mem:ci/addressing-pr-reviews` — review feedback loop + `scripts/pr-review-monitor.sh`; patterns for fixing bot findings: fail-closed API errors, no result caps (paginate), TDD pure helpers, dry-run hides side-effects. See also `docs/pr-review-monitor.md`.
- Tooling / environment:
  - `mem:env/serena-config` — Serena project registry (`~/.serena/serena_config.yml`); stale worktree paths break activation; server caches the list at startup.
