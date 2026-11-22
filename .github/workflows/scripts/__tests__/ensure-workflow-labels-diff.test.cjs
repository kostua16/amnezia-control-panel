/* eslint-disable @typescript-eslint/no-require-imports */
// Read-once / write-only-differences label setup: a fake gh answers the label
// list and records every write, so no test touches the GitHub API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  reconcileLabels,
  resolveMode,
} = require('../ensure-workflow-labels.cjs');
const {
  createArgs,
  planLabelChanges,
  updateArgs,
} = require('../lib/workflow-labels-diff.cjs');

const POLICY = {
  'auto-fix': { color: 'e4e669', description: 'Automation fix' },
  'area/planning': { color: '1d76db', description: 'Planning artifacts' },
  'flow/checks-failed': { color: 'b60205', description: 'Checks failed' },
};

function ghError(stderr) {
  const error = new Error('Command failed: gh');
  error.stderr = stderr;
  return error;
}

function fakeGh({ existing = [], listError = null, onWrite = () => {} } = {}) {
  const writes = [];
  const waits = [];
  const warnings = [];
  let lists = 0;
  return {
    run: (args) => {
      if (args[0] === 'label' && args[1] === 'list') {
        lists += 1;
        if (listError) throw listError;
        return JSON.stringify(existing);
      }
      writes.push(args);
      onWrite(args);
      return '';
    },
    wait: (ms) => waits.push(ms),
    warn: (line) => warnings.push(line),
    writes,
    waits,
    warnings,
    lists: () => lists,
  };
}

function inSync() {
  return Object.entries(POLICY).map(([name, label]) => ({ name, ...label }));
}

const ALL = Object.keys(POLICY);

test('a repository matching policy costs one read and zero writes', () => {
  const gh = fakeGh({ existing: inSync() });
  const result = reconcileLabels(ALL, POLICY, gh);
  assert.equal(gh.lists(), 1);
  assert.deepEqual(gh.writes, []);
  assert.equal(result.mode, 'diff');
  assert.equal(result.unchanged, 3);
  assert.equal(result.ensured, 3);
});

test('labels are read with gh label list (GraphQL-backed), one call', () => {
  const calls = [];
  reconcileLabels(['auto-fix'], POLICY, {
    run: (args) => {
      calls.push(args);
      return JSON.stringify(inSync());
    },
    wait: () => {},
    warn: () => {},
  });
  assert.deepEqual(calls, [
    ['label', 'list', '--json', 'name,color,description', '--limit', '1000'],
  ]);
});

test('one missing label is created once, without --force', () => {
  const gh = fakeGh({
    existing: inSync().filter((label) => label.name !== 'auto-fix'),
  });
  const result = reconcileLabels(ALL, POLICY, gh);
  assert.deepEqual(gh.writes, [
    [
      'label',
      'create',
      'auto-fix',
      '--color',
      'e4e669',
      '--description',
      'Automation fix',
    ],
  ]);
  assert.equal(result.created, 1);
});

test('color or description drift is one PATCH per label with the slash encoded', () => {
  const existing = inSync().map((label) => {
    if (label.name === 'area/planning') return { ...label, color: '000000' };
    if (label.name === 'flow/checks-failed')
      return { ...label, description: 'old text' };
    return label;
  });
  const gh = fakeGh({ existing });
  const result = reconcileLabels(ALL, POLICY, gh);
  assert.equal(result.updated, 2);
  assert.deepEqual(gh.writes, [
    [
      'api',
      '--method',
      'PATCH',
      'repos/{owner}/{repo}/labels/area%2Fplanning',
      '-f',
      'color=1d76db',
      '-f',
      'description=Planning artifacts',
      '--silent',
    ],
    [
      'api',
      '--method',
      'PATCH',
      'repos/{owner}/{repo}/labels/flow%2Fchecks-failed',
      '-f',
      'color=b60205',
      '-f',
      'description=Checks failed',
      '--silent',
    ],
  ]);
});

test('comparison ignores color case, a leading # and description whitespace', () => {
  const existing = inSync().map((label) => ({
    ...label,
    color: `#${label.color.toUpperCase()}`,
    description: `  ${label.description} `,
  }));
  const gh = fakeGh({ existing });
  reconcileLabels(ALL, POLICY, gh);
  assert.deepEqual(gh.writes, []);
});

test('names match case-insensitively and a differently spelled label is never renamed', () => {
  const existing = inSync().map((label) =>
    label.name === 'auto-fix'
      ? { ...label, name: 'Auto-Fix', description: 'drifted' }
      : label,
  );
  const gh = fakeGh({ existing });
  reconcileLabels(ALL, POLICY, gh);
  assert.equal(gh.writes.length, 1);
  assert.equal(gh.writes[0][3], 'repos/{owner}/{repo}/labels/Auto-Fix');
  assert.ok(!gh.writes[0].some((arg) => /^(new_)?name=/.test(arg)));
});

test('a create that loses the race to a concurrent reconciler counts as success', () => {
  const gh = fakeGh({
    onWrite: () => {
      throw ghError(
        'label with name "auto-fix" already exists; use `--force` to update its color and description',
      );
    },
  });
  const result = reconcileLabels(['auto-fix'], POLICY, gh);
  assert.equal(result.created, 1);
  assert.equal(result.failed, 0);
  assert.equal(gh.writes.length, 1, 'already-exists is not retried');
  assert.deepEqual(gh.waits, []);
  assert.deepEqual(gh.warnings, []);
});

test('an update answering 404 warns and continues with the next label', () => {
  const existing = inSync().map((label) => ({ ...label, color: '000000' }));
  const gh = fakeGh({
    existing,
    onWrite: (args) => {
      if (args[3].endsWith('/auto-fix'))
        throw ghError('gh: Not Found (HTTP 404)');
    },
  });
  const result = reconcileLabels(ALL, POLICY, gh);
  assert.equal(result.failed, 1);
  assert.equal(result.updated, 2);
  assert.equal(gh.writes.length, 3);
  assert.deepEqual(gh.waits, []);
  assert.match(gh.warnings[0], /label disappeared before the update/);
});

test('an exhausted quota on the list read skips every write and every sleep', () => {
  const gh = fakeGh({
    listError: ghError(
      'GraphQL: API rate limit already exceeded for installation ID 1234',
    ),
  });
  const result = reconcileLabels(ALL, POLICY, gh);
  assert.equal(result.mode, 'skipped');
  assert.deepEqual(gh.writes, []);
  assert.deepEqual(gh.waits, []);
  assert.match(gh.warnings[0], /quota exhausted, skipping label setup/);
});

test('HTTP 403 and 429 on the list read also count as quota exhaustion', () => {
  for (const stderr of [
    'HTTP 403: Forbidden',
    'gh: Too Many Requests (HTTP 429)',
  ]) {
    const gh = fakeGh({ listError: ghError(stderr) });
    assert.equal(reconcileLabels(['auto-fix'], POLICY, gh).mode, 'skipped');
    assert.deepEqual(gh.writes, []);
  }
});

test('a non-quota list failure falls back to per-label --force setup', () => {
  const gh = fakeGh({ listError: ghError('unknown flag: --json') });
  const result = reconcileLabels(['auto-fix', 'area/planning'], POLICY, gh);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.ensured, 2);
  assert.deepEqual(
    gh.writes.map((args) => [args[1], args[2], args.at(-1)]),
    [
      ['create', 'auto-fix', '--force'],
      ['create', 'area/planning', '--force'],
    ],
  );
});

test('a quota error on a write stops the remaining writes without sleeping', () => {
  const gh = fakeGh({
    onWrite: () => {
      throw ghError(
        'HTTP 403: API rate limit exceeded for installation ID 1234',
      );
    },
  });
  const result = reconcileLabels(ALL, POLICY, gh);
  assert.equal(gh.writes.length, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 2);
  assert.deepEqual(gh.waits, []);
});

test('a transient write failure is retried, then warned, never thrown', () => {
  const gh = fakeGh({
    onWrite: () => {
      throw ghError('HTTP 502: Bad Gateway');
    },
  });
  const result = reconcileLabels(['auto-fix'], POLICY, gh);
  assert.equal(gh.writes.length, 3);
  assert.deepEqual(gh.waits, [2000, 4000]);
  assert.equal(result.failed, 1);
  assert.match(gh.warnings[0], /Could not create label "auto-fix"/);
});

test('only the requested names subset is reconciled', () => {
  const gh = fakeGh();
  const result = reconcileLabels(['flow/checks-failed'], POLICY, gh);
  assert.equal(result.total, 1);
  assert.deepEqual(
    gh.writes.map((args) => args[2]),
    ['flow/checks-failed'],
  );
});

test('a requested name missing from policy throws before any API call', () => {
  const gh = fakeGh();
  assert.throws(
    () => reconcileLabels(['auto-fix', 'unknown'], POLICY, gh),
    /"unknown" is not defined in the policy file/,
  );
  assert.equal(gh.lists(), 0);
  assert.deepEqual(gh.writes, []);
});

test('duplicate requested names are planned once', () => {
  const plan = planLabelChanges(['auto-fix', 'auto-fix'], POLICY, []);
  assert.equal(plan.create.length, 1);
});

test('write arguments normalize the color and send descriptions as raw strings', () => {
  const item = {
    name: 'auto-fix',
    label: { color: '#E4E669', description: '@file' },
  };
  assert.deepEqual(createArgs(item).slice(3), [
    '--color',
    'e4e669',
    '--description',
    '@file',
  ]);
  assert.ok(updateArgs(item).includes('description=@file'));
  assert.ok(!updateArgs(item).includes('-F'));
});

test('mode defaults to diff and accepts legacy as the rollback switch', () => {
  assert.equal(resolveMode(undefined), 'diff');
  assert.equal(resolveMode(''), 'diff');
  assert.equal(resolveMode('legacy'), 'legacy');
  assert.equal(resolveMode(' LEGACY '), 'legacy');
  const original = console.warn;
  console.warn = () => {};
  try {
    assert.equal(resolveMode('bogus'), 'diff');
  } finally {
    console.warn = original;
  }
});

test('the full-policy callers pass the rollback switch through the action input', () => {
  const workflows = path.resolve(__dirname, '..', '..');
  for (const file of ['pr-policy.yml', 'pr-finalizer.yml']) {
    const text = fs.readFileSync(path.join(workflows, file), 'utf8');
    assert.match(
      text,
      /uses: \.\/\.github\/actions\/ensure-workflow-labels\r?\n\s+with:\r?\n(?:\s+[\w-]+: .*\r?\n)*?\s+mode: \$\{\{ vars\.ENSURE_LABELS_MODE \|\| 'diff' \}\}/,
      `${file} must pass mode from vars.ENSURE_LABELS_MODE`,
    );
  }
  const action = fs.readFileSync(
    path.resolve(
      workflows,
      '..',
      'actions',
      'ensure-workflow-labels',
      'action.yml',
    ),
    'utf8',
  );
  assert.match(action, /\n {2}mode:\r?\n[\s\S]*?default: 'diff'/);
  assert.match(action, /--mode "\$LABEL_MODE"/);
  assert.doesNotMatch(action, /vars\./, 'composite actions must not read vars');
});
