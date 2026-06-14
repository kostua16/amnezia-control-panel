# Serena project registry

- Registry file: `~/.serena/serena_config.yml`, top-level `projects:` list of repo paths.
- Stale paths (removed codex/`.claude` worktrees) break `activate_project` — it raises `FileNotFoundError` validating each registered path. Remove dead paths from the list to fix; leave valid ones.
- The running serena MCP server caches the project list at startup — registry edits take effect only after a server/session reconnect. Back up the file (`cp … .bak.<ts>`) before editing.
- Conventions (see `memory_maintenance`): memories are dense agent notes; progressive discovery via `mem:name` references; graph root is `mem:core`. Only stable, non-obvious invariants belong here — no line numbers or commit hashes (they drift).
