import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('run-claude-params turn budget prompt', () => {
  it('keeps an 80 percent soft budget with a separate hard max buffer', () => {
    const action = fs.readFileSync(
      path.join(process.cwd(), '.github/actions/run-claude-params/action.yml'),
      'utf8',
    );

    assert.match(action, /hard_max=\$max/);
    assert.match(action, /budget=\$\(\( max \* 80 \/ 100 \)\)/);
    assert.match(action, /echo "hard_max=\$hard_max" >> "\$GITHUB_OUTPUT"/);
    assert.doesNotMatch(
      action,
      /You have at most \$\{\{ steps\.turn_budget\.outputs\.budget \}\} turns total/,
    );

    const softBudgetPrompts =
      action.match(
        /soft budget \$\{\{ steps\.turn_budget\.outputs\.budget \}\} turns; hard cap \$\{\{ steps\.turn_budget\.outputs\.hard_max \}\} turns/g,
      ) ?? [];
    assert.equal(softBudgetPrompts.length, 3);

    const bufferInstructions =
      action.match(
        /Reserve the remaining buffer only for final verification, cleanup, or reporting/g,
      ) ?? [];
    assert.equal(bufferInstructions.length, 3);
  });

  it('strips the inline comment tool when PR context is absent', () => {
    const action = fs.readFileSync(
      path.join(process.cwd(), '.github/actions/run-claude-params/action.yml'),
      'utf8',
    );

    assert.match(action, /- name: Resolve allowed tools/);
    assert.match(
      action,
      /if \[\[ -z "\$\{PR_NUMBER:-\}" && "\$tools" == \*"\$inline_comment_tool"\* \]\]; then/,
    );

    const allowedToolReferences =
      action.match(
        /--allowedTools '\$\{\{ steps\.resolve_allowed_tools\.outputs\.tools \}\}'/g,
      ) ?? [];
    assert.equal(allowedToolReferences.length, 3);
  });

  it('normalizes successful execution after action probe failure as soft success', () => {
    const action = fs.readFileSync(
      path.join(process.cwd(), '.github/actions/run-claude-params/action.yml'),
      'utf8',
    );

    assert.match(action, /claude_soft_success:/);
    assert.match(action, /claude_soft_success_reason:/);
    assert.match(action, /CHECK1_SOFT_SUCCESS:/);
    assert.match(action, /CHECK2_SOFT_SUCCESS:/);
    assert.match(action, /SOFT_SUCCESS="\$\{!SOFT_SUCCESS_VAR\}"/);
    assert.match(
      action,
      /SCAN_IS_ERROR" == "false" && "\$SCAN_NUM_TURNS" != "" && "\$SCAN_NUM_TURNS" != "null" && "\$SCAN_NUM_TURNS" != "0"/,
    );
    assert.match(action, /steps\.check-429-1\.outputs\.soft_success != 'true'/);
    assert.match(action, /steps\.check-429-2\.outputs\.soft_success != 'true'/);
  });

  it('derives PR context from the github event and gates the inline-comment helper on allow-post-inline', () => {
    const action = fs.readFileSync(
      path.join(process.cwd(), '.github/actions/run-claude-params/action.yml'),
      'utf8',
    );

    // Guard now resolves PR_NUMBER from the event so the inline-comment tool is
    // only stripped when there is genuinely no PR to comment on.
    assert.match(
      action,
      /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \|\| github\.event\.inputs\.pr_number/,
    );

    // allow-post-inline input is declared with a false default.
    assert.match(action, /allow-post-inline:\n    description: 'When true/);
    assert.match(
      action,
      /ALLOW_POST_INLINE: \$\{\{ inputs\.allow-post-inline \}\}/,
    );

    // Helper is appended to allowed-tools only when allow-post-inline is true.
    assert.match(
      action,
      /Bash\(\.\/\.github\/workflows\/scripts\/post-pr-inline-comment\.sh:\*\)/,
    );
    assert.match(action, /if \[\[ "\$ALLOW_POST_INLINE" == "true" \]\]; then/);

    // Guidance is produced by a dedicated step and injected into all prompts.
    assert.match(action, /id: resolve_inline_guidance/);
    const guidanceRefs =
      action.match(
        /steps\.resolve_inline_guidance\.outputs\.inline_guidance/g,
      ) ?? [];
    assert.equal(guidanceRefs.length, 3);
    assert.match(action, /Post actionable findings as inline review comments/);
  });

  it('ships an allowlisted post-pr-inline-comment.sh helper', () => {
    const helper = fs.readFileSync(
      path.join(
        process.cwd(),
        '.github/workflows/scripts/post-pr-inline-comment.sh',
      ),
      'utf8',
    );

    // Flags mirror the GitHub create-review-comment fields (underscore names,
    // matching the create_inline_comment MCP tool), plus --pr. No positional
    // <pr_number> and no hyphenated --start-line / --commit-id variants.
    for (const flag of [
      '--pr)',
      '--path)',
      '--line)',
      '--body)',
      '--start_line)',
      '--side)',
      '--commit_id)',
    ]) {
      assert.match(helper, new RegExp(flag.replace(/[()]/g, '\\$&')));
    }
    assert.doesNotMatch(helper, /--start-line/);
    assert.doesNotMatch(helper, /--commit-id/);
    assert.match(helper, /PR="\$\{PR_NUMBER:-\}"/);

    // Required-arg guards and a RIGHT-side default for added (+) lines.
    assert.match(helper, /--path is required/);
    assert.match(helper, /--line is required/);
    assert.match(helper, /--body is required/);
    assert.match(helper, /SIDE="RIGHT"/);
    // Numeric guards: PR/LINE are interpolated into the API path / jq args, so
    // they must be positive integers (closes path-traversal + jq-syntax escapes).
    assert.match(helper, /--pr must be a positive integer/);
    assert.match(helper, /--line must be a positive integer/);
    assert.match(helper, /--start_line must be a positive integer/);
    // --side LEFT requires an explicit --commit_id (head-SHA default is RIGHT-only).
    assert.match(helper, /--side LEFT requires an explicit --commit_id/);
    // Falls back to the PR head SHA when --commit_id is omitted.
    assert.match(helper, /gh pr view "\$PR" --repo "\$REPO" --json headRefOid/);

    // Idempotent upsert: list existing comments, PATCH an existing one or POST
    // a new one, scoped to helper-owned comments via the ownership marker.
    assert.match(helper, /<!-- pr-inline-comment -->/);
    // Injection-safe lookup: values reach jq as data (--arg/--argjson), fetched
    // as a single page; never string-interpolated into a --jq program.
    assert.match(
      helper,
      /gh api "repos\/\$\{REPO\}\/pulls\/\$\{PR\}\/comments\?per_page=100"/,
    );
    assert.match(
      helper,
      /jq -r --arg path "\$FILE_PATH" --argjson line "\$LINE" --arg marker "\$MARKER"/,
    );
    assert.doesNotMatch(helper, /--paginate/);
    assert.match(
      helper,
      /gh api -X PATCH "repos\/\$\{REPO\}\/pulls\/comments\/\$\{existing_id\}"/,
    );
    assert.match(helper, /body="\$BODY_WITH_MARKER"/);
    // Prints the resulting comment URL on both update and create paths.
    const urlPrints = helper.match(/--jq '\.html_url'/g) ?? [];
    assert.equal(urlPrints.length, 2);
  });
});
