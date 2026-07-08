/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { upsertComment } = require('../lib/sticky-comment.cjs');

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
