/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ARTIFACT_NAME_PATTERN,
  artifactNameForSha,
  buildMetricsPayload,
  getArtifactSha8,
  selectExactArtifacts,
  selectFallbackArtifacts,
  validateMetricsPayload,
  writeMetricsFile,
  resolveBaselineFromArtifacts,
} = require('../build-metrics.cjs');

const FULL_SHA = 'a'.repeat(40);
const SHA8 = FULL_SHA.slice(0, 8);

// ---------------------------------------------------------------------------
// artifactNameForSha
// ---------------------------------------------------------------------------
test('artifactNameForSha returns build-metrics-{sha8}.json', () => {
  assert.equal(
    artifactNameForSha(FULL_SHA),
    `build-metrics-${SHA8}.json`,
  );
});

test('artifactNameForSha rejects short SHA', () => {
  assert.throws(
    () => artifactNameForSha('abc123'),
    /must be a 40-character git SHA/,
  );
});

test('artifactNameForSha rejects non-hex', () => {
  assert.throws(
    () => artifactNameForSha('z'.repeat(40)),
    /must be a 40-character git SHA/,
  );
});

// ---------------------------------------------------------------------------
// getArtifactSha8
// ---------------------------------------------------------------------------
test('getArtifactSha8 extracts sha8 from valid artifact name', () => {
  assert.equal(getArtifactSha8(`build-metrics-${SHA8}.json`), SHA8);
});

test('getArtifactSha8 returns null for invalid name', () => {
  assert.equal(getArtifactSha8('other-artifact.json'), null);
  assert.equal(getArtifactSha8(''), null);
  assert.equal(getArtifactSha8(null), null);
});

test('ARTIFACT_NAME_PATTERN matches valid names', () => {
  assert.ok(ARTIFACT_NAME_PATTERN.test(`build-metrics-${SHA8}.json`));
  assert.ok(!ARTIFACT_NAME_PATTERN.test('build-metrics.json'));
  assert.ok(!ARTIFACT_NAME_PATTERN.test('build-metrics-gh123.json'));
});

// ---------------------------------------------------------------------------
// buildMetricsPayload
// ---------------------------------------------------------------------------
function makePayload(overrides = {}) {
  return buildMetricsPayload({
    sha: FULL_SHA,
    ref: 'refs/heads/main',
    runId: 42,
    runAttempt: 1,
    serverUrl: 'https://github.com',
    repository: 'org/repo',
    sizeBytes: 1024,
    durationSeconds: 30,
    runnerOs: 'linux',
    runnerArch: 'x64',
    nextCacheEnabled: false,
    ...overrides,
  });
}

test('buildMetricsPayload builds a valid payload', () => {
  const payload = makePayload();
  assert.equal(payload.schema, 1);
  assert.equal(payload.metric, 'next-build');
  assert.equal(payload.sha, FULL_SHA);
  assert.equal(payload.sha8, SHA8);
  assert.equal(payload.ref, 'refs/heads/main');
  assert.equal(payload.size_bytes, 1024);
  assert.equal(payload.duration_seconds, 30);
});

test('buildMetricsPayload requires serverUrl', () => {
  assert.throws(
    () => makePayload({ serverUrl: '' }),
    /serverUrl is required/,
  );
});

test('buildMetricsPayload requires repository', () => {
  assert.throws(
    () => makePayload({ repository: '' }),
    /repository is required/,
  );
});

// ---------------------------------------------------------------------------
// validateMetricsPayload
// ---------------------------------------------------------------------------
const VALID_METRICS = makePayload();

test('validateMetricsPayload accepts valid metrics', () => {
  const result = validateMetricsPayload(VALID_METRICS);
  assert.equal(result.valid, true);
  assert.equal(result.metrics.sha, FULL_SHA);
});

test('validateMetricsPayload rejects non-object', () => {
  assert.equal(validateMetricsPayload(null).valid, false);
  assert.equal(validateMetricsPayload('string').valid, false);
  assert.equal(validateMetricsPayload([1]).valid, false);
});

test('validateMetricsPayload rejects wrong schema', () => {
  assert.equal(
    validateMetricsPayload({ ...VALID_METRICS, schema: 2 }).valid,
    false,
  );
});

test('validateMetricsPayload rejects wrong metric type', () => {
  assert.equal(
    validateMetricsPayload({ ...VALID_METRICS, metric: 'other' }).valid,
    false,
  );
});

test('validateMetricsPayload rejects invalid sha', () => {
  assert.equal(
    validateMetricsPayload({ ...VALID_METRICS, sha: 'short' }).valid,
    false,
  );
});

test('validateMetricsPayload rejects sha mismatch with expectedSha', () => {
  const otherSha = 'b'.repeat(40);
  const result = validateMetricsPayload(
    { ...VALID_METRICS, sha: otherSha },
    { expectedSha: FULL_SHA },
  );
  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('does not match'));
});

test('validateMetricsPayload rejects sha8 mismatch', () => {
  const result = validateMetricsPayload({
    ...VALID_METRICS,
    sha: FULL_SHA,
    sha8: 'deadbeef',
  });
  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('sha8'));
});

test('validateMetricsPayload rejects non-main ref', () => {
  assert.equal(
    validateMetricsPayload({ ...VALID_METRICS, ref: 'refs/heads/dev' })
      .valid,
    false,
  );
});

test('validateMetricsPayload rejects artifact name sha8 mismatch', () => {
  const result = validateMetricsPayload(VALID_METRICS, {
    artifact: { name: 'build-metrics-badb00bc.json' },
  });
  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('artifact name'));
});

test('validateMetricsPayload rejects invalid size_bytes', () => {
  assert.equal(
    validateMetricsPayload({ ...VALID_METRICS, size_bytes: 0 }).valid,
    false,
  );
  assert.equal(
    validateMetricsPayload({ ...VALID_METRICS, size_bytes: -1 }).valid,
    false,
  );
  assert.equal(
    validateMetricsPayload({ ...VALID_METRICS, size_bytes: 'big' }).valid,
    false,
  );
});

test('validateMetricsPayload rejects invalid duration_seconds', () => {
  assert.equal(
    validateMetricsPayload({ ...VALID_METRICS, duration_seconds: -1 }).valid,
    false,
  );
});

test('validateMetricsPayload accepts artifact workflow sha match', () => {
  const result = validateMetricsPayload(VALID_METRICS, {
    artifact: {
      name: `build-metrics-${SHA8}.json`,
      workflow_run: { head_sha: FULL_SHA },
    },
  });
  assert.equal(result.valid, true);
});

test('validateMetricsPayload rejects artifact workflow sha mismatch', () => {
  const result = validateMetricsPayload(VALID_METRICS, {
    artifact: {
      name: `build-metrics-${SHA8}.json`,
      workflow_run: { head_sha: 'b'.repeat(40) },
    },
  });
  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('workflow sha'));
});

// ---------------------------------------------------------------------------
// selectExactArtifacts
// ---------------------------------------------------------------------------
function makeArtifact(overrides = {}) {
  return {
    id: 1,
    name: `build-metrics-${SHA8}.json`,
    expired: false,
    created_at: '2026-01-01T00:00:00Z',
    workflow_run: { head_branch: 'main', head_sha: FULL_SHA },
    ...overrides,
  };
}

test('selectExactArtifacts filters by name and main branch', () => {
  const artifacts = [
    makeArtifact(),
    makeArtifact({ id: 2, name: 'build-metrics-badb00bc.json' }),
    makeArtifact({ id: 3, workflow_run: { head_branch: 'feature' } }),
    makeArtifact({ id: 4, expired: true }),
  ];
  const result = selectExactArtifacts(artifacts, FULL_SHA);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test('selectExactArtifacts returns empty when no match', () => {
  const artifacts = [makeArtifact({ name: 'build-metrics-badb00bc.json' })];
  assert.equal(selectExactArtifacts(artifacts, FULL_SHA).length, 0);
});

// ---------------------------------------------------------------------------
// selectFallbackArtifacts
// ---------------------------------------------------------------------------
test('selectFallbackArtifacts selects all non-expired main artifacts with sha8 names', () => {
  const artifacts = [
    makeArtifact({ id: 1, created_at: '2026-01-02T00:00:00Z' }),
    makeArtifact({
      id: 2,
      name: 'build-metrics-badb00bc.json',
      created_at: '2026-01-03T00:00:00Z',
    }),
    makeArtifact({ id: 3, expired: true }),
    makeArtifact({ id: 4, workflow_run: { head_branch: 'dev' } }),
    makeArtifact({ id: 5, name: 'unrelated.json' }),
  ];
  const result = selectFallbackArtifacts(artifacts);
  assert.equal(result.length, 2);
  // newest first
  assert.equal(result[0].id, 2);
  assert.equal(result[1].id, 1);
});

test('selectFallbackArtifacts returns empty when no valid artifacts', () => {
  assert.equal(selectFallbackArtifacts([]).length, 0);
});

// ---------------------------------------------------------------------------
// resolveBaselineFromArtifacts — exact match
// ---------------------------------------------------------------------------
test('resolveBaselineFromArtifacts returns exact match first', () => {
  const exactArtifact = makeArtifact({ id: 10 });
  const loadMetrics = () => ({ payload: makePayload() });

  const result = resolveBaselineFromArtifacts({
    baseSha: FULL_SHA,
    exactArtifacts: [exactArtifact],
    fallbackArtifacts: [],
    loadMetrics,
  });

  assert.equal(result.found, true);
  assert.equal(result.source, 'exact-base-sha');
  assert.equal(result.metrics.sha, FULL_SHA);
});

// ---------------------------------------------------------------------------
// resolveBaselineFromArtifacts — fallback
// ---------------------------------------------------------------------------
test('resolveBaselineFromArtifacts falls back to latest main', () => {
  const otherSha = 'b'.repeat(40);
  const otherSha8 = otherSha.slice(0, 8);
  const fallbackArtifact = makeArtifact({
    id: 20,
    name: `build-metrics-${otherSha8}.json`,
    workflow_run: { head_branch: 'main', head_sha: otherSha },
  });
  const fallbackPayload = buildMetricsPayload({
    sha: otherSha,
    ref: 'refs/heads/main',
    runId: 50,
    runAttempt: 1,
    serverUrl: 'https://github.com',
    repository: 'org/repo',
    sizeBytes: 2048,
    durationSeconds: 45,
    runnerOs: 'linux',
    runnerArch: 'x64',
    nextCacheEnabled: false,
  });
  const loadMetrics = () => ({ payload: fallbackPayload });

  const result = resolveBaselineFromArtifacts({
    baseSha: FULL_SHA,
    exactArtifacts: [],
    fallbackArtifacts: [fallbackArtifact],
    loadMetrics,
  });

  assert.equal(result.found, true);
  assert.equal(result.source, 'latest-main');
  assert.equal(result.metrics.sha, 'b'.repeat(40));
});

// ---------------------------------------------------------------------------
// resolveBaselineFromArtifacts — expired / invalid artifacts
// ---------------------------------------------------------------------------
test('resolveBaselineFromArtifacts skips expired artifacts', () => {
  const loadMetrics = () => ({ payload: makePayload() });
  const result = resolveBaselineFromArtifacts({
    baseSha: FULL_SHA,
    exactArtifacts: [makeArtifact({ expired: true })],
    fallbackArtifacts: [
      makeArtifact({
        expired: true,
        name: 'build-metrics-cccccccc.json',
        workflow_run: { head_branch: 'main', head_sha: 'c'.repeat(40) },
      }),
    ],
    loadMetrics,
  });
  // Expired artifacts are filtered by selectExactArtifacts/selectFallbackArtifacts
  // before loadMetrics is called, so no failures are recorded — just not found.
  assert.equal(result.found, false);
  assert.equal(result.source, 'none');
});

test('resolveBaselineFromArtifacts skips artifacts with invalid payload', () => {
  const loadMetrics = () => ({
    payload: { schema: 99, metric: 'wrong', sha: 'x'.repeat(40) },
  });
  const result = resolveBaselineFromArtifacts({
    baseSha: FULL_SHA,
    exactArtifacts: [makeArtifact()],
    fallbackArtifacts: [],
    loadMetrics,
  });
  assert.equal(result.found, false);
});

test('resolveBaselineFromArtifacts records load failures and continues', () => {
  let callCount = 0;
  const loadMetrics = () => {
    callCount++;
    if (callCount === 1) return { error: 'download failed' };
    return { payload: makePayload() };
  };

  const result = resolveBaselineFromArtifacts({
    baseSha: FULL_SHA,
    exactArtifacts: [makeArtifact()],
    fallbackArtifacts: [makeArtifact()],
    loadMetrics,
  });

  // exact failed, fallback succeeded
  assert.equal(result.found, true);
  assert.equal(result.source, 'latest-main');
  assert.equal(result.failures.length, 1);
  assert.ok(result.failures[0].includes('download failed'));
});

// ---------------------------------------------------------------------------
// resolveBaselineFromArtifacts — missing baseline (no artifacts at all)
// ---------------------------------------------------------------------------
test('resolveBaselineFromArtifacts returns not found when no artifacts', () => {
  const result = resolveBaselineFromArtifacts({
    baseSha: FULL_SHA,
    exactArtifacts: [],
    fallbackArtifacts: [],
    loadMetrics: () => ({ payload: null }),
  });
  assert.equal(result.found, false);
  assert.equal(result.source, 'none');
  assert.equal(result.reason, 'No build metrics artifact found');
  assert.equal(result.failures.length, 0);
});

test('resolveBaselineFromArtifacts rejects non-function loadMetrics', () => {
  assert.throws(
    () => resolveBaselineFromArtifacts({ baseSha: FULL_SHA }),
    /loadMetrics callback is required/,
  );
});

// ---------------------------------------------------------------------------
// writeMetricsFile
// ---------------------------------------------------------------------------
test('writeMetricsFile writes correct file', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-metrics-test-'));
  const payload = makePayload();

  const { artifactName, metricsFile } = writeMetricsFile({
    outputDir: tmpDir,
    payload,
  });

  assert.equal(artifactName, `build-metrics-${SHA8}.json`);
  assert.equal(metricsFile, path.join(tmpDir, artifactName));

  const written = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
  assert.equal(written.schema, 1);
  assert.equal(written.sha, FULL_SHA);
  assert.equal(written.size_bytes, 1024);
});
