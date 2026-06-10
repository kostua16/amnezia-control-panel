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
});
