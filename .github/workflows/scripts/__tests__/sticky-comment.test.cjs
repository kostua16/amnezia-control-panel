/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { upsertComment, isTransient } = require('../lib/sticky-comment.cjs');

const MARKER = '<!-- sticky-test -->';

function installFakeGh(comments) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sticky-comment-test-'),
  );
  const logPath = path.join(tempDir, 'gh.log');
  const commentsPath = path.join(tempDir, 'comments.json');
  const ghPath = path.join(tempDir, 'gh');
  const previousPath = process.env.PATH;

  fs.writeFileSync(commentsPath, JSON.stringify(comments), 'utf8');
  fs.writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STICKY_GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'api' && args.includes('--paginate')) {
  process.stdout.write(fs.readFileSync(process.env.STICKY_GH_COMMENTS, 'utf8'));
}
`,
    'utf8',
  );
  fs.chmodSync(ghPath, 0o755);

  process.env.PATH = `${tempDir}:${process.env.PATH}`;
  process.env.STICKY_GH_LOG = logPath;
  process.env.STICKY_GH_COMMENTS = commentsPath;

  return {
    readCalls() {
      return fs
        .readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    cleanup() {
      process.env.PATH = previousPath;
      delete process.env.STICKY_GH_LOG;
      delete process.env.STICKY_GH_COMMENTS;
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('upsertComment replaces an existing sticky comment by default', () => {
  const gh = installFakeGh([
    {
      id: 42,
      user: { login: 'github-actions[bot]' },
      body: `${MARKER}\nold body`,
    },
  ]);

  try {
    upsertComment({
      repo: 'owner/repo',
      prNumber: 7,
      marker: MARKER,
      body: `${MARKER}\nnew body`,
    });

    assert.deepEqual(
      gh.readCalls().map((args) => args.slice(0, 4)),
      [
        ['api', 'repos/owner/repo/issues/7/comments', '--paginate'],
        ['api', '-X', 'POST', 'repos/owner/repo/issues/7/comments'],
        ['api', '-X', 'DELETE', 'repos/owner/repo/issues/comments/42'],
      ],
    );
  } finally {
    gh.cleanup();
  }
});

test('upsertComment tolerates a failed DELETE after successful POST', () => {
  // Simulate: find returns an existing comment, POST succeeds, but DELETE fails.
  // The new comment must still appear and upsertComment must NOT throw.
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sticky-comment-test-'),
  );
  const logPath = path.join(tempDir, 'gh.log');
  const commentsPath = path.join(tempDir, 'comments.json');
  const ghPath = path.join(tempDir, 'gh');
  const previousPath = process.env.PATH;

  const comments = [
    {
      id: 99,
      user: { login: 'github-actions[bot]' },
      body: `${MARKER}\nold body`,
    },
  ];
  fs.writeFileSync(commentsPath, JSON.stringify(comments), 'utf8');

  // The fake gh script fails DELETE (exit 1) but succeeds list and POST.
  fs.writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STICKY_GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'api' && args.includes('--paginate')) {
  process.stdout.write(fs.readFileSync(process.env.STICKY_GH_COMMENTS, 'utf8'));
  process.exit(0);
}
if (args[0] === 'api' && args.includes('POST')) {
  process.stdout.write('{"id":100}');
  process.exit(0);
}
if (args[0] === 'api' && args.includes('DELETE')) {
  process.stderr.write('API rate limit');
  process.exit(1);
}
`,
    'utf8',
  );
  fs.chmodSync(ghPath, 0o755);

  process.env.PATH = `${tempDir}:${process.env.PATH}`;
  process.env.STICKY_GH_LOG = logPath;
  process.env.STICKY_GH_COMMENTS = commentsPath;

  try {
    // Must NOT throw even though DELETE failed
    upsertComment({
      repo: 'owner/repo',
      prNumber: 9,
      marker: MARKER,
      body: `${MARKER}\nnew body`,
    });

    const calls = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    // Should have: list, POST, DELETE (3 calls)
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[0][0], 'api'); // list
    assert.ok(calls[1].includes('POST')); // create new
    assert.ok(calls[2].includes('DELETE')); // attempted delete
  } finally {
    process.env.PATH = previousPath;
    delete process.env.STICKY_GH_LOG;
    delete process.env.STICKY_GH_COMMENTS;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('upsertComment keeps the legacy patch path when replaceExisting is false', () => {
  const gh = installFakeGh([
    {
      id: 43,
      user: { login: 'github-actions[bot]' },
      body: `${MARKER}\nold body`,
    },
  ]);

  try {
    upsertComment({
      repo: 'owner/repo',
      prNumber: 8,
      marker: MARKER,
      body: `${MARKER}\nnew body`,
      replaceExisting: false,
    });

    assert.deepEqual(
      gh.readCalls().map((args) => args.slice(0, 4)),
      [
        ['api', 'repos/owner/repo/issues/8/comments', '--paginate'],
        ['api', '-X', 'PATCH', 'repos/owner/repo/issues/comments/43'],
      ],
    );
  } finally {
    gh.cleanup();
  }
});

// isTransient lowercases stderr before matching, so it must catch gh's
// uppercase "HTTP 5xx" form (e.g. "gh: HTTP 504: Gateway Timeout") — the exact
// transient the 5xx retry exists for. A case-sensitive uppercase pattern would
// silently disable retry on every retry-enabled call site.
test('isTransient matches gh uppercase HTTP 5xx stderr after lowercasing', () => {
  assert.ok(isTransient('gh: HTTP 504: Gateway Timeout'));
  assert.ok(isTransient('gh: HTTP 503: Service Unavailable'));
  assert.ok(isTransient('gh: server error (HTTP 500)'));
  assert.ok(isTransient('http 502')); // already-lowercased form also matches
  assert.ok(!isTransient('gh: HTTP 404: Not Found'));
});
