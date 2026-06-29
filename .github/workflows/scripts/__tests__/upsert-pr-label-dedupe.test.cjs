/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const actionPath = path.join(
  repoRoot,
  '.github/actions/upsert-pull-request/action.yml',
);

const lines = fs.readFileSync(actionPath, 'utf8').split('\n');

/**
 * Invariant: the upsert-pull-request composite action must never pass
 * `--label` to `gh pr create`. Labels must be applied after creation
 * via `gh pr edit --add-label` to avoid duplicate label events that
 * trigger redundant PR-Orchestrator wakeups.
 */
test('gh pr create must not use --label flag', () => {
  // Join lines to handle multiline YAML bash blocks as one string
  const content = lines.join('\n');
  const labelOnCreate = /pr\s+create\b[\s\S]*?--label/.test(content);

  assert.strictEqual(
    labelOnCreate,
    false,
    'upsert-pull-request must not pass --label to gh pr create (causes duplicate label events)',
  );
});

test('labels are applied via gh pr edit --add-label (not pr create)', () => {
  const content = lines.join('\n');
  const hasEditAddLabel = /--add-label/.test(content);

  assert.strictEqual(
    hasEditAddLabel,
    true,
    'upsert-pull-request must apply labels via gh pr edit --add-label',
  );
});

test('label application failures are tolerated (non-blocking)', () => {
  // Find lines with "gh pr edit" that handle labels (contain missing_label_args)
  const labelEditIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (
      /gh\s+pr\s+edit/.test(lines[i]) &&
      /missing_label_args/.test(lines[i])
    ) {
      labelEditIndices.push(i);
    }
  }

  assert.ok(
    labelEditIndices.length > 0,
    'Expected at least one label-edit line in the action',
  );

  // For each label edit, check that the line or next 2 lines have error tolerance.
  // Tolerance may be: `|| true`, `|| echo "::warning..."`, or `|| \` continuation
  // followed by `echo "::warning..."` on the next line.
  for (const idx of labelEditIndices) {
    const window = lines.slice(idx, idx + 4).join('\n');
    const hasTolerance =
      /\|\|\s*true/.test(window) ||
      /\|\|\s*echo\s+"::warning/.test(window) ||
      (/\|\|\s*\\$/.test(lines[idx]) && /echo\s+"::warning/.test(window));

    assert.strictEqual(
      hasTolerance,
      true,
      `Label edit at line ${idx + 1} must tolerate failures: "${lines[idx].trim()}"`,
    );
  }
});

test('labels are not applied twice on the create path', () => {
  // Find create_args line, then find the next "echo "created=" line
  let createStart = -1;
  let createEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/create_args=\(pr create/.test(lines[i]) && createStart < 0) {
      createStart = i;
    }
    if (createStart >= 0 && /echo "created=/.test(lines[i])) {
      createEnd = i;
      break;
    }
  }

  assert.ok(createStart >= 0, 'Could not find create_args in the action');

  const createBranchLines = lines.slice(createStart, createEnd);

  // Count actual "gh pr edit" calls that use missing_label_args
  const labelEditCount = createBranchLines.filter(
    (line) => /gh\s+pr\s+edit/.test(line) && /missing_label_args/.test(line),
  ).length;

  assert.strictEqual(
    labelEditCount,
    1,
    `Expected exactly 1 label-application call in the create path, found ${labelEditCount}`,
  );
});
