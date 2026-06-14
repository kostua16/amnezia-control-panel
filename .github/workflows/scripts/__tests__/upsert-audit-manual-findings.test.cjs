/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectManualFindings,
  fingerprintFinding,
  markerForFingerprint,
  normalizeSeverity,
  parseList,
  parseManualFindingsFromText,
  requireGitHubContext,
  renderIssueBody,
  upsertIssues,
} = require('../upsert-audit-manual-findings.cjs');

const scriptPath = path.join(
  __dirname,
  '..',
  'upsert-audit-manual-findings.cjs',
);

function runReportOnly(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-report-only-'));
  const outputPath = path.join(dir, 'github-output');
  const stdout = execFileSync(process.execPath, [scriptPath, '--report-only'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      ...env,
    },
  });
  const output = fs.readFileSync(outputPath, 'utf8');
  return { stdout, output };
}

const pr382ManualFindings = `
### Manual-only findings (need developer decisions)
- **F-02 (medium):** \`service-monitor.ts\` and \`resource-monitor.ts\` have **no tests**. Both shell out via \`execFileSync('systemctl'/'df')\` and read \`os.cpus()\` directly - testing requires a dependency-injection or module-mocking strategy (a design call, not a one-line fix).
- **F-03 (medium):** \`resource-monitor.ts\` parses \`df\` output assuming stats land on \`lines[1]\` - fragile for long device names that \`df\` wraps onto two lines. A robust fix needs a real test environment.
- **F-04 (low):** \`config-export.ts\` uses \`as ServiceType\` casts (L27, L38) - a validation decision touching API route behavior.
- **F-05 (low):** Several monitoring modules use raw \`console.log\` (\`vpn-services\`, \`panel-health-checker\`, \`tailscale\`, \`user-sync\`) - a cross-cutting logger-vs-console decision.

I made no other file changes.
`;

function makeStructuredOutput() {
  return JSON.stringify({
    fixed_findings: [
      {
        finding_id: 'F-01',
        summary: 'Stale Windows comment',
      },
    ],
    manual_findings: [
      {
        finding_id: 'F-02',
        severity: 'medium',
        summary: 'Monitoring modules have no tests',
        details:
          'service-monitor.ts and resource-monitor.ts shell out directly.',
        files: ['src/lib/service-monitor.ts', 'src/lib/resource-monitor.ts'],
      },
      {
        finding_id: 'F-03',
        severity: 'medium',
        summary: 'df parsing is fragile',
        details: 'resource-monitor.ts assumes stats land on lines[1].',
        files: ['src/lib/resource-monitor.ts'],
      },
      {
        finding_id: 'F-04',
        severity: 'low',
        summary: 'Config export casts service types',
        details: 'config-export.ts uses as ServiceType casts.',
        files: ['src/lib/config-export.ts'],
      },
      {
        finding_id: 'F-05',
        severity: 'low',
        summary: 'Monitoring modules use raw console.log',
        details: 'Several modules should use a logging abstraction.',
        files: ['src/lib/vpn-services.ts'],
      },
    ],
  });
}

test('structured output with four manual findings creates four issue payloads', () => {
  const calls = [];
  const findings = collectManualFindings({
    structuredOutput: makeStructuredOutput(),
    textFallback: '',
  });

  const result = upsertIssues({
    findings,
    sourceRunUrl: 'https://example.test/run/1',
    sourcePrUrl: 'https://example.test/pull/382',
    runGhCommand(args) {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[]';
      return '';
    },
  });

  assert.equal(result.findingCount, 4);
  assert.equal(result.createdCount, 4);
  assert.equal(result.updatedCount, 0);
  assert.equal(
    calls.filter((args) => args[0] === 'issue' && args[1] === 'create').length,
    4,
  );
  assert.deepEqual(
    calls
      .find((args) => args[0] === 'issue' && args[1] === 'create')
      .slice(0, 4),
    [
      'issue',
      'create',
      '--title',
      '[audit] F-02: Monitoring modules have no tests',
    ],
  );
});

test('PR body fallback parses F-02 through F-05 from manual-only section', () => {
  const findings = parseManualFindingsFromText(pr382ManualFindings);

  assert.equal(findings.length, 4);
  assert.deepEqual(
    findings.map((finding) => finding.findingId),
    ['F-02', 'F-03', 'F-04', 'F-05'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.severity),
    ['medium', 'medium', 'low', 'low'],
  );
  assert.match(findings[0].details, /have no tests/);
});

test('stable fingerprint deduplicates the same finding across run ids', () => {
  const finding = collectManualFindings({
    structuredOutput: makeStructuredOutput(),
    textFallback: '',
  })[0];
  const fingerprint = fingerprintFinding(finding);
  const existingBody = renderIssueBody({
    finding,
    fingerprint,
    sourceRunUrl: 'https://example.test/runs/old',
    sourcePrUrl: 'https://example.test/pull/old',
    changedFiles: [],
  });
  const calls = [];

  const result = upsertIssues({
    findings: [finding],
    sourceRunUrl: 'https://example.test/runs/new',
    sourcePrUrl: 'https://example.test/pull/new',
    runGhCommand(args) {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') {
        return JSON.stringify([
          {
            number: 123,
            title: 'old title',
            body: existingBody,
          },
        ]);
      }
      return '';
    },
  });

  assert.equal(result.createdCount, 0);
  assert.equal(result.updatedCount, 1);
  assert.ok(existingBody.includes(markerForFingerprint(fingerprint)));
  assert.equal(
    calls.some((args) => args[0] === 'issue' && args[1] === 'create'),
    false,
  );
  assert.equal(
    calls.some((args) => args[0] === 'issue' && args[1] === 'edit'),
    true,
  );
});

test('empty manual findings succeed and create nothing', () => {
  const result = upsertIssues({
    findings: [],
    runGhCommand() {
      throw new Error('gh should not be called');
    },
  });

  assert.deepEqual(result, {
    findingCount: 0,
    createdCount: 0,
    updatedCount: 0,
  });
});

test('fallback changed files render when a finding has no explicit files', () => {
  const finding = {
    findingId: 'F-06',
    severity: 'low',
    summary: 'Follow-up without explicit files',
    details: 'The audit did not attach per-finding files.',
    files: [],
  };
  const body = renderIssueBody({
    finding,
    fingerprint: fingerprintFinding(finding),
    sourceRunUrl: '',
    sourcePrUrl: '',
    changedFiles: ['src/lib/resource-monitor.ts'],
  });

  assert.match(body, /`src\/lib\/resource-monitor\.ts`/);
});

test('JSON changed file list output parses as file paths', () => {
  assert.deepEqual(parseList('["src/lib/resource-monitor.ts"]'), [
    'src/lib/resource-monitor.ts',
  ]);
});

test('report-only mode counts structured findings without GitHub context', () => {
  const { stdout, output } = runReportOnly({
    CLAUDE_STRUCTURED_OUTPUT: makeStructuredOutput(),
    GH_TOKEN: '',
    GITHUB_TOKEN: '',
    GITHUB_REPOSITORY: '',
  });

  assert.match(stdout, /Manual audit findings: 4; created: 0; updated: 0/);
  assert.match(output, /^finding_count=4$/m);
  assert.match(output, /^created_count=0$/m);
  assert.match(output, /^updated_count=0$/m);
});

test('report-only mode counts PR-body fallback findings', () => {
  const { output } = runReportOnly({
    PR_BODY: pr382ManualFindings,
    GH_TOKEN: '',
    GITHUB_TOKEN: '',
    GITHUB_REPOSITORY: '',
  });

  assert.match(output, /^finding_count=4$/m);
});

test('report-only mode emits zero when no manual findings exist', () => {
  const { output } = runReportOnly({
    PR_BODY: '## Audit complete\n\nNo manual findings.',
    CLAUDE_STRUCTURED_OUTPUT: '',
    GH_TOKEN: '',
    GITHUB_TOKEN: '',
    GITHUB_REPOSITORY: '',
  });

  assert.match(output, /^finding_count=0$/m);
});

test('normalizeSeverity lowercases values and defaults empty values', () => {
  assert.equal(normalizeSeverity('MEDIUM'), 'medium');
  assert.equal(normalizeSeverity(''), 'unspecified');
});

test('missing GitHub context fails only when findings need issue upsert', () => {
  assert.doesNotThrow(() => requireGitHubContext({}, 0));
  assert.throws(
    () => requireGitHubContext({}, 1),
    /GitHub token and GITHUB_REPOSITORY are required/,
  );
  assert.doesNotThrow(() =>
    requireGitHubContext(
      {
        GH_TOKEN: 'token',
        GITHUB_REPOSITORY: 'owner/repo',
      },
      1,
    ),
  );
});
