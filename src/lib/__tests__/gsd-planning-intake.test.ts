import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  SOURCE_HASH_MARKER,
  collectCandidates,
  isPlanningArtifact,
  runCollector,
  sha256,
} = require('../../../.github/workflows/scripts/collect-gsd-planning-intake.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-planning-intake-'));
}

function writeFile(root: string, repoPath: string, content: string) {
  const filePath = path.join(root, repoPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('collect-gsd-planning-intake', () => {
  it('recognizes observed quick artifact filename shapes and skips summaries', () => {
    assert.equal(isPlanningArtifact('260612-PLAN.md'), true);
    assert.equal(isPlanningArtifact('260601-b2n_PLAN.md'), true);
    assert.equal(isPlanningArtifact('proposal.md'), true);
    assert.equal(isPlanningArtifact('260605-pr237-SUMMARY.md'), false);
  });

  it('collects daily plans, grouped proposals, PR plans, and noncanonical plan names', () => {
    const root = makeTempDir();
    const quickDir = path.join(root, '.planning/quick');

    writeFile(
      root,
      '.planning/quick/260612-arch-review/260612-PLAN.md',
      '# Architectural Review\n\nHigh priority follow-up.',
    );
    writeFile(
      root,
      '.planning/quick/260609-typed-api-client/proposal.md',
      '# Typed API Client\n\nMedium priority follow-up.',
    );
    writeFile(
      root,
      '.planning/quick/260605-pr237-workflow-improve/260605-pr237-PLAN.md',
      '# Quick Plan: PR #237 workflow improvement intake\n',
    );
    writeFile(
      root,
      '.planning/quick/260601-b2n-infrastructure-abstraction/260601-b2n_PLAN.md',
      '# Infrastructure Abstraction\n',
    );
    writeFile(
      root,
      '.planning/quick/260605-pr237-workflow-improve/260605-pr237-SUMMARY.md',
      '# Summary\n',
    );

    const candidates = collectCandidates({ quickDir });

    assert.deepEqual(
      candidates.map((candidate: { title: string }) => candidate.title),
      [
        'Architectural Review',
        'Typed API Client',
        'Infrastructure Abstraction',
        'Quick Plan: PR #237 workflow improvement intake',
      ],
    );
    assert.equal(
      candidates.find(
        (candidate: { source_pr: number | null }) =>
          candidate.source_pr === 237,
      )?.source_pr,
      237,
    );
  });

  it('dedupes artifacts already imported into the queue by source hash', () => {
    const root = makeTempDir();
    const quickDir = path.join(root, '.planning/quick');
    const queueDir = path.join(
      root,
      '.planning/phases/999-gh-planning-execution-queue',
    );
    const content = '# Proposal\n\nAlready queued.';
    const artifactPath = writeFile(
      root,
      '.planning/quick/260609-example/proposal.md',
      content,
    );
    writeFile(
      root,
      '.planning/phases/999-gh-planning-execution-queue/999-001-PLAN.md',
      [
        '---',
        `source_artifact: "${artifactPath}"`,
        `source_artifact_sha256: ${sha256(content)}`,
        'wave: 1',
        '---',
      ].join('\n'),
    );

    const result = runCollector({ quickDir, queueDir, write: false });

    assert.equal(result.has_candidate, false);
    assert.equal(result.skipped[0].reason, 'already-imported-hash');
  });

  it('dedupes artifacts already represented by an open execution PR marker', () => {
    const root = makeTempDir();
    const quickDir = path.join(root, '.planning/quick');
    const queueDir = path.join(
      root,
      '.planning/phases/999-gh-planning-execution-queue',
    );
    const content = '# Proposal\n\nIn flight.';
    const hash = sha256(content);
    const openPrsFile = path.join(root, 'open-prs.json');

    writeFile(root, '.planning/quick/260609-example/proposal.md', content);
    fs.writeFileSync(
      openPrsFile,
      JSON.stringify([{ body: `${SOURCE_HASH_MARKER} ${hash} -->` }]),
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile,
      write: false,
    });

    assert.equal(result.has_candidate, false);
    assert.equal(result.skipped[0].reason, 'open-execution-pr');
  });

  it('writes one canonical Phase 999 plan with source metadata', () => {
    const root = makeTempDir();
    const quickDir = path.join(root, '.planning/quick');
    const queueDir = path.join(
      root,
      '.planning/phases/999-gh-planning-execution-queue',
    );

    writeFile(
      root,
      '.planning/quick/260609-example/proposal.md',
      '# Example Proposal\n\nImplement a narrow follow-up.',
    );

    const result = runCollector({ quickDir, queueDir, write: true });
    const selected = result.selected[0];
    const plan = fs.readFileSync(selected.plan_path, 'utf8');

    assert.equal(result.has_candidate, true);
    assert.equal(selected.plan, '999-001');
    assert.equal(selected.wave, 1);
    assert.match(plan, /^phase: 999$/m);
    assert.match(plan, /^type: execute$/m);
    assert.match(plan, /^source_artifact_sha256: [a-f0-9]{64}$/m);
    assert.match(plan, /# Plan 999-001: Example Proposal/);
    assert.match(plan, /## Source Artifact Snapshot/);
  });
});
