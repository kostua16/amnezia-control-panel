import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

function readAction(): string {
  const actionPath = path.join(
    repoRoot,
    '.github/actions/upsert-pull-request/action.yml',
  );
  return fs.readFileSync(actionPath, 'utf8');
}

describe('upsert-pull-request action', () => {
  it('creates PRs before applying labels and uses add-label for edits', () => {
    const action = readAction();

    assert.match(action, /missing_label_args=\(\)/);
    assert.match(action, /missing_label_args\+=\(--add-label "\$label"\)/);
    assert.match(
      action,
      /gh pr edit "\$pr_number" "\$\{missing_label_args\[@\]\}" >/,
    );
    assert.doesNotMatch(
      action,
      /gh "\$\{create_args\[@\]\}" "\$\{missing_label_args\[@\]\}"/,
    );
    assert.match(
      action,
      /Pull request created without applying one or more labels/,
    );
  });

  it('applies missing labels regardless of draft status', () => {
    const action = readAction();

    assert.match(action, /build_missing_label_args\(\)/);
    assert.match(
      action,
      /if \[\[ "\$\{#missing_label_args\[@\]\}" -gt 0 \]\]; then/,
    );
    assert.doesNotMatch(
      action,
      /Deferring label application for draft PR creation/,
    );
  });

  it('applies deferred labels after a draft PR is readied', () => {
    const action = readAction();

    assert.match(action, /gh pr ready "\$pr_number"/);
    assert.match(action, /is_draft="false"/);
  });
});
