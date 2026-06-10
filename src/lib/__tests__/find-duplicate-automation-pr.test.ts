import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  extractPatchFromGitDiff,
  findExactDuplicatePullRequest,
  hasExactDuplicate,
  normalizePatch,
  sortedFilePatches,
} = require('../../../.github/workflows/scripts/find-duplicate-automation-pr.cjs');

describe('find-duplicate-automation-pr', () => {
  it('normalizes patches and sorts files by path', () => {
    assert.equal(
      normalizePatch('@@ -1 +1 @@\r\n-test\r\n+prod\r\n'),
      '@@ -1 +1 @@\n-test\n+prod',
    );
    assert.deepEqual(
      sortedFilePatches([
        { path: 'b.yml', patch: 'two' },
        { filename: 'a.yml', patch: 'one' },
      ]),
      [
        { path: 'a.yml', patch: 'one' },
        { path: 'b.yml', patch: 'two' },
      ],
    );
  });

  it('extracts hunk-only patches from git diff output', () => {
    const diff = [
      'diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml',
      'index 1111111..2222222 100644',
      '--- a/.github/workflows/ci.yml',
      '+++ b/.github/workflows/ci.yml',
      '@@ -41,7 +41,7 @@ jobs:',
      '-    needs: [lint, typecheck]',
      '+    needs: [typecheck]',
    ].join('\n');

    assert.equal(
      extractPatchFromGitDiff(diff),
      [
        '@@ -41,7 +41,7 @@ jobs:',
        '-    needs: [lint, typecheck]',
        '+    needs: [typecheck]',
      ].join('\n'),
    );
  });

  it('matches exact duplicates only when paths and patches are identical', () => {
    const localFiles = [
      {
        path: '.github/workflows/ci.yml',
        patch: '@@ -1 +1 @@\n-needs: [lint, typecheck]\n+needs: [typecheck]',
      },
    ];

    assert.equal(
      hasExactDuplicate(localFiles, [
        {
          filename: '.github/workflows/ci.yml',
          patch: '@@ -1 +1 @@\n-needs: [lint, typecheck]\n+needs: [typecheck]',
        },
      ]),
      true,
    );

    assert.equal(
      hasExactDuplicate(localFiles, [
        {
          filename: '.github/workflows/ci.yml',
          patch: '@@ -1 +1 @@\n-needs: [lint, typecheck]\n+needs: [lint]',
        },
      ]),
      false,
    );
  });

  it('returns the first pull request whose files exactly match the local diff', () => {
    const localFiles = [
      {
        path: '.github/workflows/ci.yml',
        patch: '@@ -1 +1 @@\n-needs: [lint, typecheck]\n+needs: [typecheck]',
      },
    ];
    const pullRequests = [
      {
        number: 254,
        title: 'ci(workflows): hourly optimization - 27091863075',
      },
      {
        number: 261,
        title: 'ci(workflows): hourly optimization - 27173158874',
      },
    ];
    const filesByPr = new Map([
      [
        254,
        [
          {
            filename: '.github/workflows/ci.yml',
            patch:
              '@@ -1 +1 @@\n-needs: [lint, typecheck]\n+needs: [typecheck]',
          },
        ],
      ],
      [
        261,
        [
          {
            filename: '.github/workflows/perf-check.yml',
            patch: '@@ -1 +1 @@\n-install-rtk: true\n+install-rtk: false',
          },
        ],
      ],
    ]);

    const duplicate = findExactDuplicatePullRequest(
      localFiles,
      pullRequests,
      (pullRequest: { number: number }) =>
        filesByPr.get(pullRequest.number) ?? [],
    );

    assert.equal(duplicate?.number, 254);
  });
});
