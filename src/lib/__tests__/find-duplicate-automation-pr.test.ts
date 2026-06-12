import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  extractPatchFromGitDiff,
  findDuplicatePullRequest,
  hasExactDuplicate,
  hasEquivalentDuplicate,
  normalizePatch,
  normalizeSubstantivePatch,
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

  it('keeps only substantive diff lines when comparing semantic duplicates', () => {
    assert.equal(
      normalizeSubstantivePatch(
        [
          '@@ -47,7 +47,8 @@ concurrency:',
          '+  # Keep only the newest PR state.',
          '-  cancel-in-progress: old-value',
          '+  cancel-in-progress: true',
        ].join('\n'),
      ),
      ['-  cancel-in-progress: old-value', '+  cancel-in-progress: true'].join(
        '\n',
      ),
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

  it('matches equivalent duplicates when differences are comment-only', () => {
    const localFiles = [
      {
        path: '.github/workflows/pr-flow.yml',
        patch:
          '@@ -47,7 +47,7 @@ concurrency:\n-  cancel-in-progress: ${{ old }}\n+  cancel-in-progress: true',
      },
    ];

    assert.equal(
      hasEquivalentDuplicate(localFiles, [
        {
          filename: '.github/workflows/pr-flow.yml',
          patch: [
            '@@ -47,7 +47,8 @@ concurrency:',
            '+  # Keep only the newest PR state.',
            '-  cancel-in-progress: ${{ old }}',
            '+  cancel-in-progress: true',
          ].join('\n'),
        },
      ]),
      true,
    );
  });

  it('does not treat comment-only-only diffs as equivalent duplicates', () => {
    const localFiles = [
      {
        path: '.github/workflows/pr-flow.yml',
        patch: '@@ -47,7 +47,8 @@ concurrency:\n+  # Local comment only',
      },
    ];

    assert.equal(
      hasEquivalentDuplicate(localFiles, [
        {
          filename: '.github/workflows/pr-flow.yml',
          patch: '@@ -47,7 +47,8 @@ concurrency:\n+  # Remote comment only',
        },
      ]),
      false,
    );
  });

  it('returns the first pull request whose files are an exact or equivalent duplicate', () => {
    const localFiles = [
      {
        path: '.github/workflows/pr-flow.yml',
        patch:
          '@@ -47,7 +47,7 @@ concurrency:\n-  cancel-in-progress: ${{ old }}\n+  cancel-in-progress: true',
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
            filename: '.github/workflows/pr-flow.yml',
            patch: [
              '@@ -47,7 +47,8 @@ concurrency:',
              '+  # Keep only the newest PR state.',
              '-  cancel-in-progress: ${{ old }}',
              '+  cancel-in-progress: true',
            ].join('\n'),
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

    const duplicate = findDuplicatePullRequest(
      localFiles,
      pullRequests,
      (pullRequest: { number: number }) =>
        filesByPr.get(pullRequest.number) ?? [],
    );

    assert.equal(duplicate?.pullRequest.number, 254);
    assert.equal(duplicate?.matchKind, 'equivalent');
  });
});
