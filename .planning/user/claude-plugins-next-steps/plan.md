# Next steps after merging PR #390 — Claude plugins in CI manual validation

PR #390 (`feat(ci): add Claude Code plugin profiles to run-zai workflows`) wires plugins into 11
workflows via per-purpose profiles (E/R/P). The code changes are complete, but several things can
**only** be verified by running the plugin-enabled workflows in CI after merge. Work through this
checklist on the first runs after merge.

## 1. Confirm the pinned action accepts plugin inputs

Watch every Profile E/R/P run log for `Unexpected input 'plugins'` or
`Unexpected input 'plugin_marketplaces'`.

- If the pinned `anthropics/claude-code-action@b2532c6eeaeae7a645f37943ed5a7e51870d1d90` rejects
  them, bump the pin in `.github/actions/run-claude-params/action.yml` (lines 300, 389, 476) to a
  newer SHA/tag that supports plugins (the `plugins` input landed in PR #638 of
  claude-code-action), then re-run.

## 2. Verify marketplace resolution

Confirm no `Invalid marketplace URL format` or `marketplace not found` errors. This validates the
full-Git-URL fix (`https://github.com/anthropics/claude-plugins-official.git` +
`https://github.com/juliusbrussee/caveman.git`).

- If still rejected, the action version may want a different format; fallback options: raw
  `marketplace.json` URL, or a newer action pin.

## 3. Verify exact MCP tool prefixes

For one run each of Profile E, R, and P, inspect these `run-zai` outputs:

- `claude_tool_breakdown` — tools Claude actually called
- `claude_rejected_tools_list` — tools Claude tried but were denied

Confirm serena/context7/typescript-lsp tools appear in **breakdown** (loaded + allowed) and NOT
in **rejected** (allowed-tools correct).

- If they're rejected, the `mcp__plugin_*` prefix assumption (`mcp__plugin_serena_serena__*`,
  `mcp__plugin_context7_context7__*`, `mcp__plugin_typescript-lsp__*`) is wrong. Update each
  workflow's `allowed-tools` to the real names found in the rejected list.

## 4. Lock down the typescript-lsp wildcard

Replace the temporary `mcp__plugin_typescript-lsp__*` wildcard (in all Profile E + R flows'
`allowed-tools`) with the specific typescript-lsp tool names discovered in step 3. Avoids
unintentionally allowing a future typescript-lsp write tool.

## 5. Confirm serena MCP server starts

Check that serena tools appear in `claude_tool_breakdown` — proves `uv` installed and the serena
MCP server launched.

- If absent, inspect the `setup-environment` `uv` install step. If uv failed, either fix
  `uv-version` or drop serena from the affected profile (plugins install but can't act).

## 6. Verify plugin slugs resolved

Confirm no `plugin not found` errors. If a slug is wrong (e.g. `pr-review-toolkit` vs
`pr-review`, `code-simplifier` vs `code-simplify`), check
`anthropics/claude-plugins-official` `.claude-plugin/marketplace.json` and correct the `plugins:`
block in the affected workflow.

## 7. Turn-budget guard

Compare `claude_turns_budget_pct` / `claude_num_turns` before vs after on the tightest flows:

- `pr-improve` (40 turns), `issue-catch-up` (30), `dependency-review` (haiku)

If `superpowers` + `caveman` bloat context and erode budget on Profile P, trim them from Profile P
(keep only `context7, serena`).

## 8. Cost monitoring

Check `claude_total_cost_usd` hasn't risen materially (serena is the heaviest plugin — MCP server
startup + symbol indexing). If cost spike is unacceptable, reconsider serena scope or reduce
plugin counts in Profile E.

## 9. Security re-check

Grep every changed workflow's `allowed-tools` to confirm:

- No `execute_shell_command`
- No `mcp__plugin_serena_serena__*` wildcard (only the explicit read-only serena tools)
- No serena write tools (`replace_*`, `edit_*`, `write_memory`, `create_text_file`,
  `safe_delete_symbol`, `delete_memory`)

```bash
grep -rn "execute_shell_command\|mcp__plugin_serena_serena__\*\|_replace_\|_write_memory\|_create_text_file\|_safe_delete\|_delete_memory" .github/workflows/*.yml
# Expect: no matches
```
