import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('upsert-pull-request action', () => {
  it('creates PRs before applying labels and uses add-label for edits', () => {
    const action = fs.readFileSync(
      path.join(
        process.cwd(),
        '.github/actions/upsert-pull-request/action.yml',
      ),
      'utf8',
    );

    assert.match(action, /edit_label_args=\(\)/);
    assert.match(action, /edit_label_args\+=\(--add-label "\$label"\)/);
    assert.match(
      action,
      /gh pr edit "\$pr_number" "\$\{edit_label_args\[@\]\}" >/,
    );
    assert.doesNotMatch(
      action,
      /gh "\$\{create_args\[@\]\}" "\$\{create_label_args\[@\]\}"/,
    );
    assert.match(
      action,
      /Pull request created without applying one or more labels/,
    );
  });
});
