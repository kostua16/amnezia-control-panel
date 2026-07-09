/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPlanArtifact,
  selectPromotableIssue,
} = require('../promote-deferred-proposal.cjs');

function issue(overrides = {}) {
  return {
    number: 100,
    title: '[gsd-deferred] Add request logging middleware',
    body: 'Proposal body with details.',
    labels: ['needs-review', 'gsd-deferred-proposal', 'area/planning'],
    createdAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

test('G10: selects the oldest eligible deferred-proposal issue', () => {
  const newer = issue({ number: 101, createdAt: '2026-07-02T10:00:00.000Z' });
  const older = issue({ number: 102, createdAt: '2026-06-30T10:00:00.000Z' });
  const selected = selectPromotableIssue([newer, older]);
  assert.equal(selected.number, 102);
});

test('G10: excludes security/critical/keep-open/in-progress and empty bodies', () => {
  assert.equal(
    selectPromotableIssue([
      issue({ labels: ['gsd-deferred-proposal', 'security'] }),
      issue({ labels: ['gsd-deferred-proposal', 'critical'] }),
      issue({ labels: ['gsd-deferred-proposal', 'keep-open'] }),
      issue({ labels: ['gsd-deferred-proposal', 'in-progress'] }),
      issue({ body: '   ' }),
      issue({ labels: ['unrelated'] }),
    ]),
    null,
  );
});

test('G10: accepts label objects as returned by the GitHub API', () => {
  const selected = selectPromotableIssue([
    issue({ labels: [{ name: 'gsd-deferred-proposal' }] }),
  ]);
  assert.equal(selected.number, 100);
});

test('G11: artifact filename passes the planning-intake collector filter', () => {
  const { isPlanningArtifact } = require('../collect-gsd-planning-intake.cjs');
  const artifact = buildPlanArtifact(issue());
  assert.equal(artifact.path, '.planning/quick/deferred-issue-100-plan.md');
  assert.equal(isPlanningArtifact(artifact.path), true);
});

test('G11: artifact strips the [gsd-deferred] prefix and keeps provenance', () => {
  const artifact = buildPlanArtifact(issue());
  assert.match(artifact.content, /^# Add request logging middleware\n/);
  assert.match(artifact.content, /deferred-proposal issue #100/);
  assert.match(artifact.content, /Proposal body with details\./);
});
