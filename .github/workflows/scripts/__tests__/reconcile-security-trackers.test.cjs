/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TRACKER_LABELS,
  parseArgs,
  extractAdvisoryIds,
  advisoryIdsFromAudit,
  classifyTracker,
  reconcileTrackers,
  renderMatrix,
  fetchCandidateIssues,
} = require('../reconcile-security-trackers.cjs');

function issue(overrides = {}) {
  return {
    number: overrides.number ?? 100,
    title: overrides.title ?? 'Security: something',
    body: overrides.body ?? '',
    state: overrides.state ?? 'OPEN',
    labels: overrides.labels ?? ['security', 'triaged'],
  };
}

// ── extractAdvisoryIds: normalization ─────────────────────────────────

test('extractAdvisoryIds canonicalizes case and dedupes', () => {
  const ids = extractAdvisoryIds(
    'fixed ghsa-2v37-7h3g-55p8 and GHSA-2V37-7H3G-55P8 plus CVE-2026-33327 and cve-2026-33327',
  );
  assert.deepEqual(ids, {
    ghsa: ['GHSA-2V37-7H3G-55P8'],
    cve: ['CVE-2026-33327'],
  });
});

test('extractAdvisoryIds returns empty shapes for no-id text', () => {
  assert.deepEqual(extractAdvisoryIds('no advisories here'), { ghsa: [], cve: [] });
  assert.deepEqual(extractAdvisoryIds(''), { ghsa: [], cve: [] });
});

// ── advisoryIdsFromAudit ──────────────────────────────────────────────

test('advisoryIdsFromAudit collects ids from via[] advisory objects only', () => {
  const audit = {
    vulnerabilities: {
      'postcss': {
        via: [
          { url: 'https://github.com/advisories/GHSA-r28c-9q8g-f849', title: 'postcss path traversal' },
        ],
      },
      'brace-expansion': {
        via: [
          { title: 'ReDoS CVE-2025-12345', url: '' },
          'eslint', // transitive chain entry — no id, must be skipped
        ],
      },
    },
  };
  assert.deepEqual(advisoryIdsFromAudit(audit), [
    'CVE-2025-12345',
    'GHSA-R28C-9Q8G-F849',
  ]);
});

test('advisoryIdsFromAudit on a zero-vulnerability audit returns []', () => {
  assert.deepEqual(
    advisoryIdsFromAudit({
      metadata: { vulnerabilities: { total: 0 } },
    }),
    [],
  );
  assert.deepEqual(advisoryIdsFromAudit({}), []);
});

// ── classifyTracker ───────────────────────────────────────────────────

test('classifyTracker: security label + advisory id = security-tracker', () => {
  assert.equal(
    classifyTracker(issue({ body: 'tracked GHSA-mh99-v99m-4gvg' })),
    'security-tracker',
  );
});

test('classifyTracker accepts gh-style label objects ({name}) as well as strings', () => {
  assert.equal(
    classifyTracker(
      issue({
        labels: [{ name: 'security' }, { name: 'high' }],
        body: 'GHSA-2v37-7h3g-55p8',
      }),
    ),
    'security-tracker',
  );
  assert.equal(
    classifyTracker(issue({ labels: [{ name: 'bug' }], body: 'GHSA-2v37-7h3g-55p8' })),
    'unrelated',
  );
});

test('classifyTracker: dependencies label also marks a tracker', () => {
  assert.equal(
    classifyTracker(issue({ labels: ['dependencies'], body: 'CVE-2026-33327 chain' })),
    'security-tracker',
  );
  assert.deepEqual(TRACKER_LABELS, ['security', 'dependencies']);
});

test('classifyTracker: security label without any advisory id = no-advisory-id', () => {
  assert.equal(
    classifyTracker(issue({ title: 'Security: vague concern', body: 'no ids' })),
    'no-advisory-id',
  );
});

test('classifyTracker: issue without security/dependencies labels = unrelated', () => {
  assert.equal(
    classifyTracker(issue({ labels: ['bug'], body: 'mentions GHSA-2v37-7h3g-55p8 in passing' })),
    'unrelated',
  );
  assert.equal(classifyTracker(issue({ labels: [] })), 'unrelated');
});

// ── reconcileTrackers ────────────────────────────────────────────────

test('reconcileTrackers marks fixed only when every referenced id is absent', () => {
  const rows = reconcileTrackers({
    trackers: [
      issue({ number: 967, body: 'GHSA-mh99-v99m-4gvg' }),
      issue({ number: 1036, body: 'GHSA-2v37-7h3g-55p8' }),
    ],
    presentIds: [], // zero-vulnerability audit
  });
  assert.deepEqual(
    rows.map((r) => [r.number, r.verdict]),
    [[967, 'fixed'], [1036, 'fixed']],
  );
  assert.deepEqual(rows[0].matched_ids, []);
});

test('reconcileTrackers keeps a partially-affected tracker open with matched ids', () => {
  const rows = reconcileTrackers({
    trackers: [
      issue({ number: 1, body: 'GHSA-a111-aaaa-aaaa and CVE-2026-11111' }),
    ],
    presentIds: ['GHSA-A111-AAAA-AAAA'],
  });
  assert.equal(rows[0].verdict, 'open-vulnerable');
  assert.deepEqual(rows[0].matched_ids, ['GHSA-A111-AAAA-AAAA']);
});

test('reconcileTrackers is case-insensitive across tracker text and audit ids', () => {
  const rows = reconcileTrackers({
    trackers: [issue({ body: 'ghsa-b222-bbbb-bbbb' })],
    presentIds: ['GHSA-B222-BBBB-BBBB'],
  });
  assert.equal(rows[0].verdict, 'open-vulnerable');
});

test('reconcileTrackers sorts rows by issue number for stable output', () => {
  const rows = reconcileTrackers({
    trackers: [
      issue({ number: 30 }),
      issue({ number: 10 }),
      issue({ number: 20 }),
    ],
    presentIds: [],
  });
  assert.deepEqual(rows.map((r) => r.number), [10, 20, 30]);
});

// ── renderMatrix ─────────────────────────────────────────────────────

test('renderMatrix renders the canonical matrix with audit summary', () => {
  const rows = reconcileTrackers({
    trackers: [issue({ number: 967, title: 'brace-expansion DoS', body: 'GHSA-mh99-v99m-4gvg' })],
    presentIds: [],
  });
  const matrix = renderMatrix({
    auditIds: [],
    rows,
    ignored: { unrelated: [], 'no-advisory-id': [issue({ number: 952, title: 'common', labels: ['security'] })] },
  });
  assert.match(matrix, /#967/);
  assert.match(matrix, /GHSA-MH99-V99M-4GVG/);
  assert.match(matrix, /\| fixed \|/);
  assert.match(matrix, /none \(0 vulnerabilities\)/);
  assert.match(matrix, /#952/);
});

// ── fetchCandidateIssues (injected gh runner) ────────────────────────

test('fetchCandidateIssues sweeps both labels, dedupes, and streams via --jq .[]', () => {
  const calls = [];
  const shared = issue({ number: 922, title: '[GROUPED] consolidation' });
  const runner = (args) => {
    calls.push(args);
    if (args.includes('security')) {
      return {
        ok: true,
        stdout: [
          JSON.stringify(shared),
          JSON.stringify(issue({ number: 967, body: 'GHSA-mh99-v99m-4gvg' })),
        ].join('\n'),
      };
    }
    return {
      ok: true,
      stdout: JSON.stringify(issue({ number: 1036, labels: ['dependencies'], body: 'GHSA-2v37-7h3g-55p8' })).concat('\n'),
    };
  };
  const issues = fetchCandidateIssues('owner/repo', runner);

  assert.equal(issues.length, 3); // 922 counted once despite both labels
  assert.deepEqual(issues.map((i) => i.number), [922, 967, 1036]);
  for (const call of calls) {
    const jqIndex = call.indexOf('--jq');
    assert.equal(call[jqIndex + 1], '.[]');
    assert.ok(call.includes('--state'), 'scans closed trackers too');
    assert.ok(!call.includes('--paginate'), 'gh issue list rejects --paginate');
  }
});

test('fetchCandidateIssues tolerates a failing label query', () => {
  const issues = fetchCandidateIssues('owner/repo', () => ({
    ok: false,
    stdout: '',
    error: 'HTTP 502',
  }));
  assert.deepEqual(issues, []);
});

// ── CLI-facing helpers ────────────────────────────────────────────────

test('parseArgs maps kebab flags and keeps bare flags as true', () => {
  const args = parseArgs(['--audit-file', 'a.json', '--repo', 'o/r', '--json']);
  assert.equal(args.auditFile, 'a.json');
  assert.equal(args.repo, 'o/r');
  assert.equal(args.json, 'true');
});

test('script file exists and exports the reconciliation contract', () => {
  const scriptPath = path.join(
    __dirname,
    '..',
    'reconcile-security-trackers.cjs',
  );
  assert.ok(fs.existsSync(scriptPath));
  const { spawnSync } = require('node:child_process');
  const run = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
  assert.equal(run.status, 1, 'missing --audit-file must exit 1');
  assert.match(run.stderr, /Error: missing --audit-file/);
});
