/* eslint-disable @typescript-eslint/no-require-imports */
// History-only Kilo sticky-comment edits are dropped before they wake the PR
// Orchestrator or Auto Cover Review. Before/after bodies are consecutive real
// revisions of the Kilo sticky comment on PR #1181.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  KILO_HISTORY_MARKER,
  isKiloHistoryOnlyEdit,
} = require('../lib/kilo.cjs');
const {
  classifyKiloCommentEdit,
  run,
} = require('../classify-kilo-comment-edit.cjs');

const SCRIPT = path.join(__dirname, '..', 'classify-kilo-comment-edit.cjs');
const { revisions } = require('./fixtures/kilo-sticky-comment-revisions.json');

function body(index) {
  const found = revisions.find((rev) => rev.index === index);
  assert.ok(found, `fixture revision ${index} exists`);
  return found.body;
}

function editEvent(before, after, overrides = {}) {
  return {
    action: 'edited',
    issue: { number: 1181, pull_request: {} },
    comment: {
      user: { login: 'kilo-code-bot[bot]', type: 'Bot' },
      body: after,
    },
    changes: { body: { from: before } },
    ...overrides,
  };
}

test('real first edit of a review (current review rewritten) is relevant', () => {
  // Revision 3 -> 4: new verdict, files and range above the history marker.
  assert.notEqual(
    body(3).split(KILO_HISTORY_MARKER)[0],
    body(4).split(KILO_HISTORY_MARKER)[0],
  );
  assert.equal(isKiloHistoryOnlyEdit(editEvent(body(3), body(4))), false);
  assert.equal(isKiloHistoryOnlyEdit(editEvent(body(5), body(7))), false);
});

test('real second edit of a review (history grows only) is history-only', () => {
  for (const [before, after] of [
    [4, 5],
    [16, 17],
  ]) {
    assert.notEqual(body(before), body(after));
    assert.equal(
      isKiloHistoryOnlyEdit(editEvent(body(before), body(after))),
      true,
      `${before} -> ${after}`,
    );
  }
});

test('CRLF differences alone do not make an edit relevant', () => {
  const before = body(4).replace(/\n/g, '\r\n');
  assert.equal(isKiloHistoryOnlyEdit(editEvent(before, body(5))), true);
});

test('anything that is not a provable history-only edit stays relevant', () => {
  const before = body(4);
  const after = body(5);
  const cases = {
    created: editEvent(before, after, { action: 'created' }),
    'missing previous body': editEvent(before, after, { changes: {} }),
    'previous body not a string': editEvent(before, after, {
      changes: { body: { from: null } },
    }),
    'previous body without history marker': editEvent(body(1), after),
    'new body without history marker': editEvent(before, body(1)),
    'not a Kilo login': editEvent(before, after, {
      comment: { user: { login: 'octocat' }, body: after },
    }),
    'GraphQL-style Kilo login': editEvent(before, after, {
      comment: { user: { login: 'kilo-code-bot' }, body: after },
    }),
    'no sticky marker': editEvent(before, after, {
      comment: {
        user: { login: 'kilo-code-bot[bot]' },
        body: after.replace('<!-- kilo-review -->', ''),
      },
    }),
    'empty event': {},
  };
  for (const [name, event] of Object.entries(cases)) {
    assert.equal(isKiloHistoryOnlyEdit(event), false, name);
  }
  assert.equal(isKiloHistoryOnlyEdit(undefined), false);
});

test('classifyKiloCommentEdit drops only history-only edits and honours the off switch', () => {
  const historyOnly = editEvent(body(4), body(5));
  assert.deepEqual(classifyKiloCommentEdit({ event: historyOnly }), {
    should_run: false,
    history_only: true,
    reason: 'Kilo edit changed only the review history.',
  });
  assert.equal(
    classifyKiloCommentEdit({ event: historyOnly, filter: 'OFF' }).should_run,
    true,
  );
  assert.equal(
    classifyKiloCommentEdit({ event: editEvent(body(3), body(4)) }).should_run,
    true,
  );
});

test('the CLI writes GITHUB_OUTPUT lines and keeps the wake on any failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-edit-'));
  try {
    const eventPath = path.join(dir, 'event.json');
    fs.writeFileSync(eventPath, JSON.stringify(editEvent(body(4), body(5))));
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, '--event-path', eventPath, '--filter', ''],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    assert.equal(stdout, 'should_run=false\nhistory_only=true\n');

    assert.equal(
      run(['node', SCRIPT, '--event-path', path.join(dir, 'missing.json')], {}),
      'should_run=true\nhistory_only=false\n',
    );
    fs.writeFileSync(eventPath, '{not json');
    assert.equal(
      run(['node', SCRIPT, '--event-path', eventPath], {}),
      'should_run=true\nhistory_only=false\n',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
