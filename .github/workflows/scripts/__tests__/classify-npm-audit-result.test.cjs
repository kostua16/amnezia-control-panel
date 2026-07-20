/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RESULTS,
  classifyNpmAuditResult,
} = require('../classify-npm-audit-result.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function auditReport(total) {
  return {
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: total,
        critical: 0,
        total,
      },
    },
  };
}

test('classifies a successful audit report as clean', () => {
  assert.equal(
    classifyNpmAuditResult({ exitCode: 0, report: auditReport(0) }),
    RESULTS.CLEAN,
  );
});

test('classifies exit 1 with audit metadata as vulnerabilities', () => {
  assert.equal(
    classifyNpmAuditResult({ exitCode: 1, report: auditReport(2) }),
    RESULTS.VULNERABILITIES,
  );
});

test('classifies npm registry error payloads as infrastructure failures', () => {
  assert.equal(
    classifyNpmAuditResult({
      exitCode: 1,
      report: { error: { code: 'ECONNREFUSED', summary: 'audit failed' } },
    }),
    RESULTS.INFRASTRUCTURE,
  );
});

test('classifies malformed or missing reports as infrastructure failures', () => {
  assert.equal(
    classifyNpmAuditResult({ exitCode: 1, report: null }),
    RESULTS.INFRASTRUCTURE,
  );
  assert.equal(
    classifyNpmAuditResult({ exitCode: 0, report: {} }),
    RESULTS.INFRASTRUCTURE,
  );
});

test('classifies unexpected nonzero exits as infrastructure failures', () => {
  assert.equal(
    classifyNpmAuditResult({ exitCode: 2, report: auditReport(2) }),
    RESULTS.INFRASTRUCTURE,
  );
});

test('weekly workflow routes issues by validated audit result', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/security-audit-weekly.yml'),
    'utf8',
  );

  assert.match(workflow, /steps\.audit\.outputs\.result == 'vulnerabilities'/);
  assert.match(workflow, /steps\.audit\.outputs\.result == 'infrastructure'/);
  assert.doesNotMatch(workflow, /steps\.audit\.outputs\.exit-code == '1'/);
});
