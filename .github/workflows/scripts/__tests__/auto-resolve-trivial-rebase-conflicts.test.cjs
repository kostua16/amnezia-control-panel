/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeTrivialConflicts,
  autoResolveTrivialRebaseConflicts,
  parseUnmergedEntries,
} = require('../auto-resolve-trivial-rebase-conflicts.cjs');

const SAME_OID = '1111111111111111111111111111111111111111';
const OTHER_OID = '2222222222222222222222222222222222222222';

function entry({ mode = '100644', oid = SAME_OID, stage, file }) {
  return `${mode} ${oid} ${stage}\t${file}\0`;
}

function entriesFor(file, options = {}) {
  const {
    oursOid = SAME_OID,
    theirsOid = SAME_OID,
    oursMode = '100644',
    theirsMode = '100644',
  } = options;
  return (
    entry({ stage: 1, oid: OTHER_OID, file }) +
    entry({ stage: 2, oid: oursOid, mode: oursMode, file }) +
    entry({ stage: 3, oid: theirsOid, mode: theirsMode, file })
  );
}

function fakeFs() {
  const writes = [];
  const chmods = [];
  return {
    writes,
    chmods,
    existsSync: () => false,
    mkdirSync: () => {},
    writeFileSync: (file, content) => {
      writes.push({ file, content: Buffer.from(content).toString('utf8') });
    },
    chmodSync: (file, mode) => {
      chmods.push({ file, mode });
    },
  };
}

function fakeGit({ queue, blobs = { [SAME_OID]: 'same content\n' } }) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    const key = args.join(' ');
    if (key === 'ls-files -u -z') return queue[0] ?? '';
    if (key.startsWith('cat-file -p ')) {
      const oid = args[2];
      return Buffer.from(blobs[oid] ?? '');
    }
    if (args[0] === 'add') return '';
    if (key === '-c core.editor=true rebase --continue') {
      queue.shift();
      return '';
    }
    throw new Error(`unexpected git command: ${key}`);
  };
  git.calls = calls;
  return git;
}

test('parseUnmergedEntries parses git ls-files -u -z output', () => {
  assert.deepEqual(
    parseUnmergedEntries(entriesFor('a.txt')).map((e) => e.stage),
    [1, 2, 3],
  );
});

test('identical add/add conflict resolves and continues', () => {
  const fsImpl = fakeFs();
  const git = fakeGit({ queue: [entriesFor('.planning/PROJECT.md'), ''] });
  const result = autoResolveTrivialRebaseConflicts({
    git,
    fsImpl,
    rebaseInProgress: () => false,
  });

  assert.equal(result.attempted, true);
  assert.equal(result.resolved, true);
  assert.equal(result.rebase_complete, true);
  assert.equal(result.resolved_count, 1);
  assert.deepEqual(result.resolved_paths, ['.planning/PROJECT.md']);
  assert.deepEqual(fsImpl.writes, [
    { file: '.planning/PROJECT.md', content: 'same content\n' },
  ]);
  assert.ok(
    git.calls.some(
      (args) => args.join(' ') === '-c core.editor=true rebase --continue',
    ),
  );
});

test('repeated identical conflicts resolve across multiple rebase steps', () => {
  const fsImpl = fakeFs();
  const git = fakeGit({
    queue: [entriesFor('first.md'), entriesFor('second.md'), ''],
  });
  const result = autoResolveTrivialRebaseConflicts({
    git,
    fsImpl,
    rebaseInProgress: () => false,
  });

  assert.equal(result.rebase_complete, true);
  assert.equal(result.resolved_count, 2);
  assert.deepEqual(result.resolved_paths, ['first.md', 'second.md']);
});

test('identical conflict plus different-content conflict fails closed untouched', () => {
  const fsImpl = fakeFs();
  const output =
    entriesFor('same.md') +
    entriesFor('different.md', { theirsOid: OTHER_OID });
  const git = fakeGit({ queue: [output] });
  const result = autoResolveTrivialRebaseConflicts({
    git,
    fsImpl,
    rebaseInProgress: () => true,
  });

  assert.equal(result.rebase_complete, false);
  assert.match(result.reason, /content differs for different\.md/);
  assert.deepEqual(fsImpl.writes, []);
  assert.equal(
    git.calls.some((args) => args[0] === 'add'),
    false,
  );
});

test('same blob with different mode fails closed', () => {
  const analysis = analyzeTrivialConflicts(
    parseUnmergedEntries(
      entriesFor('script.sh', { oursMode: '100644', theirsMode: '100755' }),
    ),
  );
  assert.equal(analysis.ok, false);
  assert.match(analysis.reason, /mode mismatch/);
});

test('missing stage 2 or stage 3 fails closed', () => {
  const analysis = analyzeTrivialConflicts(
    parseUnmergedEntries(entry({ stage: 2, file: 'only-ours.md' })),
  );
  assert.equal(analysis.ok, false);
  assert.match(analysis.reason, /missing stage 2 or stage 3/);
});
