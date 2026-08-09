/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildAlertBody, getManualLabels } = require('../file-queue-starvation-alert.cjs');

// ── buildAlertBody ─────────────────────────────────────────────────

test('buildAlertBody includes percentile table', () => {
  const telemetry = {
    percentiles: { p50: 120, p75: 250, p95: 420, p99: 600, max: 1000 },
    sampleCount: 15,
    threshold: 300,
  };
  const body = buildAlertBody(telemetry, 'https://example.com/run/123');
  assert.ok(body.includes('| p50'));
  assert.ok(body.includes('420s'));
  assert.ok(body.includes('1000s'));
});

test('buildAlertBody includes run URL', () => {
  const telemetry = {
    percentiles: { p50: 10, p75: 20, p95: 50, p99: 80, max: 100 },
    sampleCount: 5,
    threshold: 300,
  };
  const body = buildAlertBody(telemetry, 'https://example.com/run/456');
  assert.ok(body.includes('https://example.com/run/456'));
});

test('buildAlertBody includes threshold info', () => {
  const telemetry = {
    percentiles: { p50: 10, p75: 20, p95: 350, p99: 500, max: 800 },
    sampleCount: 10,
    threshold: 300,
  };
  const body = buildAlertBody(telemetry, 'https://example.com/run/1');
  assert.ok(body.includes('p95 > 300s'));
  assert.ok(body.includes('**350s**'));
});

test('buildAlertBody includes possible causes', () => {
  const telemetry = {
    percentiles: { p50: 10, p75: 20, p95: 50, p99: 80, max: 100 },
    sampleCount: 3,
    threshold: 300,
  };
  const body = buildAlertBody(telemetry, 'https://example.com/run/1');
  assert.ok(body.includes('Possible Causes'));
  assert.ok(body.includes('Runner pool exhaustion'));
});

test('buildAlertBody includes WHO-E03 signature', () => {
  const telemetry = {
    percentiles: { p50: 10, p75: 20, p95: 50, p99: 80, max: 100 },
    sampleCount: 3,
    threshold: 300,
  };
  const body = buildAlertBody(telemetry, 'https://example.com/run/1');
  assert.ok(body.includes('WHO-E03'));
});

// ── getManualLabels ──────────────────────────────────────────────

test('getManualLabels reads from policy.json auditSafe.manualLabels', () => {
  const policyFile = path.join(
    __dirname,
    '__mocks__',
    'policy-starvation.json',
  );
  const originalArgv = process.argv;
  const originalCwd = process.cwd;
  // Ensure mock dir exists
  fs.mkdirSync(path.join(__dirname, '__mocks__'), { recursive: true });
  fs.writeFileSync(
    policyFile,
    JSON.stringify({
      auditSafe: {
        manualLabels: ['auto-fix', 'custom-label', 'needs-review'],
      },
    }),
    'utf8',
  );
  process.argv = ['node', 'script.cjs', '--policy-file', policyFile];
  process.cwd = () => '/tmp';
  try {
    const labels = getManualLabels();
    assert.equal(labels, 'auto-fix,custom-label,needs-review');
  } finally {
    process.argv = originalArgv;
    process.cwd = originalCwd;
    fs.unlinkSync(policyFile);
    fs.rmdirSync(path.join(__dirname, '__mocks__'));
  }
});

test('getManualLabels falls back to defaults when policy file missing', () => {
  const originalArgv = process.argv;
  const originalCwd = process.cwd;
  process.argv = ['node', 'script.cjs', '--policy-file', '/nonexistent/path/policy.json'];
  process.cwd = () => '/tmp';
  try {
    const labels = getManualLabels();
    assert.equal(labels, 'auto-fix,needs-review');
  } finally {
    process.argv = originalArgv;
    process.cwd = originalCwd;
  }
});
