/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  GSD_DEFERRED_MODE,
  collectManualFindings,
  fingerprintFinding,
  markerForFingerprint,
  normalizeSeverity,
  parseGsdDeferredProposalsFromText,
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

function runReportOnly(env, args = ['--report-only']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-report-only-'));
  const outputPath = path.join(dir, 'github-output');
  const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
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

const pr386DeferredProposals = `
### Proposals deferred (scoped out as "smallest useful" — rationale)

- **Proposal 1 (transaction boundaries):** The POST handler already implements a compensating-transaction pattern. For PUT/DELETE, the external VPN CLI/HTTP calls are interleaved with DB writes and cannot live inside \`prisma.$transaction\`.
  A clean wrap would mean restructuring the handlers and test harness.
- **Proposal 2 (decompose \`vpn-services.ts\`):** Pure structural refactor of functions the artifact itself calls stubs "by design." High churn, low immediate value.

## What Changed
- \`prisma/schema.prisma\`
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
  const createCall = calls.find(
    (args) => args[0] === 'issue' && args[1] === 'create',
  );
  assert.ok(createCall.includes('--label'), 'create path must use --label');
  assert.ok(
    !createCall.includes('--add-label'),
    'create path must not use --add-label',
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

test('GSD fallback parses Proposal 1 and Proposal 2 from deferred section', () => {
  const findings = parseGsdDeferredProposalsFromText(pr386DeferredProposals);

  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((finding) => finding.findingId),
    ['Proposal 1', 'Proposal 2'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.summary),
    ['transaction boundaries', 'decompose vpn-services.ts'],
  );
  assert.deepEqual(
    findings.map((finding) => finding.severity),
    ['deferred', 'deferred'],
  );
  assert.match(findings[0].details, /compensating-transaction/);
  assert.match(findings[0].details, /restructuring the handlers/);
});

test('GSD mode creates one issue per deferred proposal with GSD labels', () => {
  const calls = [];
  const findings = collectManualFindings({
    structuredOutput: '',
    textFallback: pr386DeferredProposals,
    mode: GSD_DEFERRED_MODE,
  });

  const result = upsertIssues({
    findings,
    mode: GSD_DEFERRED_MODE,
    sourceRunUrl: 'https://example.test/run/386',
    sourceArtifact: '.planning/quick/260611-arch-review-deep/260611-PLAN.md',
    sourceHash:
      '8409d0c920f97f984749b9094a2e9e9f4585154359a9139983c0d12ff3e807dc',
    importedPlan:
      '.planning/phases/999-gh-planning-execution-queue/999-007-PLAN.md',
    sourceTitle: 'Architectural Review: Deep Follow-up Improvements',
    runGhCommand(args) {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[]';
      return '';
    },
  });

  assert.equal(result.findingCount, 2);
  assert.equal(result.createdCount, 2);
  assert.equal(result.updatedCount, 0);
  assert.equal(
    calls.filter((args) => args[0] === 'issue' && args[1] === 'create').length,
    2,
  );
  const createCall = calls.find(
    (args) => args[0] === 'issue' && args[1] === 'create',
  );
  assert.deepEqual(createCall.slice(0, 4), [
    'issue',
    'create',
    '--title',
    '[gsd-deferred] Proposal 1: transaction boundaries',
  ]);
  assert.ok(createCall.includes('--label'), 'create path must use --label');
  assert.ok(
    createCall.includes('gsd-deferred-proposal'),
    'create path must apply the deferred proposal label',
  );
  assert.ok(
    !createCall.includes('--add-label'),
    'create path must not use --add-label',
  );
});

test('GSD mode deduplicates deferred proposals by source and marker', () => {
  const finding = collectManualFindings({
    structuredOutput: '',
    textFallback: pr386DeferredProposals,
    mode: GSD_DEFERRED_MODE,
  })[0];
  const sourceHash =
    '8409d0c920f97f984749b9094a2e9e9f4585154359a9139983c0d12ff3e807dc';
  const fingerprint = fingerprintFinding(finding, {
    fingerprintSalt: sourceHash,
  });
  const existingBody = renderIssueBody({
    finding,
    fingerprint,
    sourceRunUrl: 'https://example.test/runs/old',
    sourceHash,
    changedFiles: [],
    mode: GSD_DEFERRED_MODE,
  });
  const calls = [];

  const result = upsertIssues({
    findings: [finding],
    mode: GSD_DEFERRED_MODE,
    sourceHash,
    runGhCommand(args) {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') {
        return JSON.stringify([
          {
            number: 3861,
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
  assert.ok(
    existingBody.includes(
      markerForFingerprint(fingerprint, 'gsd-deferred-proposal'),
    ),
  );
  assert.equal(
    calls.some((args) => args[0] === 'issue' && args[1] === 'create'),
    false,
  );
  const editCall = calls.find(
    (args) => args[0] === 'issue' && args[1] === 'edit',
  );
  assert.ok(editCall.includes('--add-label'), 'edit path must use --add-label');
  assert.ok(!editCall.includes('--label'), 'edit path must not use --label');
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
  const editCall = calls.find(
    (args) => args[0] === 'issue' && args[1] === 'edit',
  );
  assert.ok(editCall.includes('--add-label'), 'edit path must use --add-label');
  assert.ok(!editCall.includes('--label'), 'edit path must not use --label');
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

test('GSD report-only mode counts deferred proposals and zeroes without section', () => {
  const withDeferred = runReportOnly(
    {
      CLAUDE_LAST_OUTPUT: pr386DeferredProposals,
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      GITHUB_REPOSITORY: '',
    },
    ['--mode', GSD_DEFERRED_MODE, '--report-only'],
  );
  assert.match(
    withDeferred.stdout,
    /GSD deferred proposals: 2; created: 0; updated: 0/,
  );
  assert.match(withDeferred.output, /^finding_count=2$/m);

  const withoutDeferred = runReportOnly(
    {
      CLAUDE_LAST_OUTPUT: '## Done\n\nNo deferred proposals.',
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      GITHUB_REPOSITORY: '',
    },
    ['--mode', GSD_DEFERRED_MODE, '--report-only'],
  );
  assert.match(withoutDeferred.output, /^finding_count=0$/m);
});

test('normalizeSeverity lowercases values and defaults empty values', () => {
  assert.equal(normalizeSeverity('MEDIUM'), 'medium');
  assert.equal(normalizeSeverity(''), 'unspecified');
  assert.equal(normalizeSeverity('info'), 'info');
  assert.equal(normalizeSeverity('warning'), 'warning');
  assert.equal(normalizeSeverity('urgent'), 'urgent');
  assert.equal(normalizeSeverity('deferred'), 'deferred');
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
