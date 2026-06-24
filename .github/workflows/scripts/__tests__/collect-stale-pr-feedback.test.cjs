/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { formatMultiPrBundle } = require('../collect-stale-pr-feedback.cjs');

const TWO_PRS = [
  {
    number: 460,
    title: 'VPN adapter refactor',
    url: 'https://example/pull/460',
    labels: ['area/backend', 'auto-fix'],
    headRef: 'claude/vpn-460',
    mergeable: 'MERGEABLE',
    files: ['src/lib/vpn.ts', 'src/lib/user.ts'],
    threads: [
      {
        path: 'src/lib/vpn.ts',
        line: 12,
        author: 'kilo-code-bot',
        body: 'guard null',
      },
    ],
    reviews: [{ state: 'CHANGES_REQUESTED', author: 'carol', body: 'plz fix' }],
    diff: 'diff --git a/src/lib/vpn.ts',
  },
  {
    number: 444,
    title: 'User creation consistency',
    url: 'https://example/pull/444',
    labels: [],
    headRef: 'claude/user-444',
    mergeable: 'CONFLICTING',
    files: ['src/lib/user.ts'],
    threads: [],
    reviews: [],
    diff: '_diff unavailable_',
  },
];

test('renders the Source PRs header with metadata for every PR', () => {
  const md = formatMultiPrBundle({ prs: TWO_PRS });
  assert.match(md, /# Stale PR consolidation feedback/);
  assert.match(md, /## Source PRs/);
  assert.match(md, /#460: VPN adapter refactor/);
  assert.match(md, /url: https:\/\/example\/pull\/460/);
  assert.match(md, /labels: area\/backend, auto-fix/);
  assert.match(md, /head ref: claude\/vpn-460/);
  assert.match(md, /mergeability: CONFLICTING/);
});

test('renders per-PR unresolved threads and skips PRs with none', () => {
  const md = formatMultiPrBundle({ prs: TWO_PRS });
  assert.match(md, /## Unresolved review threads by PR/);
  assert.match(md, /### PR #460/);
  assert.match(md, /`src\/lib\/vpn\.ts`:12 \(@kilo-code-bot\): guard null/);
  // #444 has no threads so it must not get a thread subsection
  assert.doesNotMatch(md, /### PR #444[\s\S]*?## Review submissions/);
});

test('renders review submissions per PR', () => {
  const md = formatMultiPrBundle({ prs: TWO_PRS });
  assert.match(md, /## Review submissions by PR/);
  assert.match(md, /@carol, CHANGES_REQUESTED\): plz fix/);
});

test('renders diffs and changed-file lists per PR even when diff is unavailable', () => {
  const md = formatMultiPrBundle({ prs: TWO_PRS });
  assert.match(md, /## Diffs by PR/);
  assert.match(md, /Changed files \(2\):/);
  assert.match(md, /- src\/lib\/vpn\.ts/);
  assert.match(md, /```diff\ndiff --git/);
  // Truncated/unavailable diff still fenced
  assert.match(md, /```diff\n_diff unavailable_\n```/);
});

test('labels empty sections when there are no threads and no reviews', () => {
  const md = formatMultiPrBundle({
    prs: [
      {
        number: 1,
        title: 'x',
        url: '',
        labels: [],
        headRef: 'b',
        mergeable: 'MERGEABLE',
        files: ['a.ts'],
        threads: [],
        reviews: [],
        comments: [],
        diff: 'd',
      },
    ],
  });
  assert.match(md, /Unresolved review threads by PR[\s\S]*?_None\./);
  assert.match(md, /Review submissions by PR[\s\S]*?_None\./);
  assert.match(md, /Comments by PR[\s\S]*?_None\./);
});

test('renders non-noise comments per PR', () => {
  const md = formatMultiPrBundle({
    prs: [
      {
        number: 7,
        title: 'x',
        url: '',
        labels: [],
        headRef: 'b',
        mergeable: 'MERGEABLE',
        files: ['a.ts'],
        threads: [],
        reviews: [],
        comments: [{ author: 'alice', body: 'consider extracting a helper' }],
        diff: 'd',
      },
    ],
  });
  assert.match(md, /## Comments by PR \(non-command, human\)/);
  assert.match(md, /### PR #7/);
  assert.match(md, /@alice\): consider extracting a helper/);
});
