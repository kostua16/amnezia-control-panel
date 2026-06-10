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
    assert.doesNotMatch(
      action,
      /gh "\$\{create_args\[@\]\}" "\$\{edit_label_args\[@\]\}"/,
    );
    assert.match(
      action,
      /Pull request created without applying one or more labels/,
    );
  });

  it('defers labels while a pull request remains draft', () => {
    const action = readAction();

    assert.ok(
      action.includes(
        'if [[ "${#edit_label_args[@]}" -gt 0 && ! ( "$PR_DRAFT" == "true" && "$is_draft" == "true" ) ]]; then',
      ),
    );
    assert.match(
      action,
      /Deferring label application for draft PR creation to avoid duplicate labeled workflow triggers\./,
    );
    assert.ok(
      action.includes(
        'if [[ "$PR_DRAFT" == "false" && "${#edit_label_args[@]}" -gt 0 ]]; then',
      ),
    );
  });

  it('applies deferred labels after a draft PR is readied', () => {
    const action = readAction();

    assert.match(action, /gh pr ready "\$pr_number"/);
    assert.match(action, /is_draft="false"/);
  });
});
