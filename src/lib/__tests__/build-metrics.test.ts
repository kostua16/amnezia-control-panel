import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  artifactNameForSha,
  buildMetricsPayload,
  resolveBaselineFromArtifacts,
  selectFallbackArtifacts,
  validateMetricsPayload,
} = require('../../../.github/workflows/scripts/build-metrics.cjs');

const baseSha = '0123456789abcdef0123456789abcdef01234567';
const collisionSha = '01234567ffffffffffffffffffffffffffffffff';
const newerSha = 'fedcba9876543210fedcba9876543210fedcba98';

function artifact({
  id,
  name = artifactNameForSha(baseSha),
  sha = baseSha,
  branch = 'main',
  expired = false,
  createdAt = '2026-06-03T00:00:00Z',
}: {
  id: number;
  name?: string;
  sha?: string;
  branch?: string;
  expired?: boolean;
  createdAt?: string;
}) {
  return {
    id,
    name,
    expired,
    created_at: createdAt,
    workflow_run: {
      id: id + 1000,
      head_branch: branch,
      head_sha: sha,
    },
  };
}

function metrics(
  sha: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...buildMetricsPayload({
      sha,
      ref: 'refs/heads/main',
      runId: '123',
      runAttempt: '1',
      serverUrl: 'https://github.com',
      repository: 'owner/repo',
      sizeBytes: '1048576',
      durationSeconds: '42',
      runnerOs: 'Linux',
      runnerArch: 'X64',
      nextCacheEnabled: 'true',
      createdAt: '2026-06-03T00:00:00.000Z',
      ...overrides,
    }),
    ...overrides,
  };
}

function resolveWithPayloads({
  exactArtifacts = [],
  fallbackArtifacts = [],
  payloads = {},
}: {
  exactArtifacts?: Array<Record<string, unknown>>;
  fallbackArtifacts?: Array<Record<string, unknown>>;
  payloads?: Record<number, Record<string, unknown> | Error>;
}) {
  return resolveBaselineFromArtifacts({
    baseSha,
    exactArtifacts,
    fallbackArtifacts,
    loadMetrics: (candidate: { id: number }) => {
      const payload = payloads[candidate.id];
      if (payload instanceof Error) {
        return { error: payload.message };
      }
      return { payload };
    },
  });
}

describe('build metrics baseline selection', () => {
  it('selects an exact base-SHA artifact when metrics validate', () => {
    const candidate = artifact({ id: 1 });
    const result = resolveWithPayloads({
      exactArtifacts: [candidate],
      payloads: { 1: metrics(baseSha) },
    });

    assert.equal(result.found, true);
    assert.equal(result.source, 'exact-base-sha');
    assert.equal(result.metrics.sha, baseSha);
    assert.equal(result.artifact.id, 1);
  });

  it('rejects short-SHA collisions and keeps looking for the full base SHA', () => {
    const collision = artifact({
      id: 1,
      sha: collisionSha,
      createdAt: '2026-06-03T00:02:00Z',
    });
    const exact = artifact({
      id: 2,
      sha: baseSha,
      createdAt: '2026-06-03T00:01:00Z',
    });
    const result = resolveWithPayloads({
      exactArtifacts: [collision, exact],
      payloads: {
        1: metrics(collisionSha),
        2: metrics(baseSha),
      },
    });

    assert.equal(result.found, true);
    assert.equal(result.source, 'exact-base-sha');
    assert.equal(result.artifact.id, 2);
    assert.match(result.failures[0], /does not match PR base sha/);
  });

  it('falls back to the newest valid main artifact when exact metrics are absent', () => {
    const older = artifact({
      id: 1,
      name: artifactNameForSha(baseSha),
      sha: baseSha,
      createdAt: '2026-06-03T00:01:00Z',
    });
    const newer = artifact({
      id: 2,
      name: artifactNameForSha(newerSha),
      sha: newerSha,
      createdAt: '2026-06-03T00:02:00Z',
    });
    const feature = artifact({
      id: 3,
      name: artifactNameForSha(newerSha),
      sha: newerSha,
      branch: 'feature',
      createdAt: '2026-06-03T00:03:00Z',
    });
    const result = resolveWithPayloads({
      fallbackArtifacts: [older, newer, feature],
      payloads: {
        1: metrics(baseSha),
        2: metrics(newerSha),
        3: metrics(newerSha),
      },
    });

    assert.equal(result.found, true);
    assert.equal(result.source, 'latest-main');
    assert.equal(result.artifact.id, 2);
    assert.equal(result.metrics.sha, newerSha);
  });

  it('ignores expired artifacts', () => {
    const expired = artifact({ id: 1, expired: true });
    const result = resolveWithPayloads({
      exactArtifacts: [expired],
      fallbackArtifacts: [expired],
      payloads: { 1: metrics(baseSha) },
    });

    assert.equal(result.found, false);
    assert.equal(result.source, 'none');
  });

  it('skips invalid JSON or invalid payloads before using fallback metrics', () => {
    const invalid = artifact({ id: 1 });
    const fallback = artifact({
      id: 2,
      name: artifactNameForSha(newerSha),
      sha: newerSha,
      createdAt: '2026-06-03T00:02:00Z',
    });
    const result = resolveWithPayloads({
      exactArtifacts: [invalid],
      fallbackArtifacts: [fallback],
      payloads: {
        1: new Error('Unexpected token'),
        2: metrics(newerSha),
      },
    });

    assert.equal(result.found, true);
    assert.equal(result.source, 'latest-main');
    assert.equal(result.artifact.id, 2);
    assert.match(result.failures[0], /Unexpected token/);
  });

  it('returns no baseline when no matching artifact exists', () => {
    const result = resolveWithPayloads({
      fallbackArtifacts: [
        artifact({ id: 1, name: 'unrelated-artifact', sha: baseSha }),
      ],
    });

    assert.equal(result.found, false);
    assert.equal(result.source, 'none');
    assert.match(result.reason, /No build metrics artifact found/);
  });

  it('validates artifact name, full SHA, size, and duration invariants', () => {
    const validArtifact = artifact({ id: 1 });
    const valid = validateMetricsPayload(metrics(baseSha), {
      artifact: validArtifact,
      expectedSha: baseSha,
    });
    const wrongArtifactName = validateMetricsPayload(metrics(baseSha), {
      artifact: artifact({
        id: 2,
        name: artifactNameForSha(newerSha),
        sha: baseSha,
      }),
    });
    const invalidSize = validateMetricsPayload(
      metrics(baseSha, { size_bytes: 0 }),
      {
        artifact: validArtifact,
      },
    );

    assert.equal(valid.valid, true);
    assert.equal(wrongArtifactName.valid, false);
    assert.equal(invalidSize.valid, false);
  });

  it('filters fallback candidates to non-expired main build metric artifacts', () => {
    const candidates = selectFallbackArtifacts([
      artifact({ id: 1, name: 'not-metrics' }),
      artifact({ id: 2, expired: true }),
      artifact({ id: 3, branch: 'feature' }),
      artifact({ id: 4 }),
    ]);

    assert.deepEqual(
      candidates.map((candidate: { id: number }) => candidate.id),
      [4],
    );
  });
});
