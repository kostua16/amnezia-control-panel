/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBody,
  buildSourceRunUrl,
  classifyAuditFix,
  parseNumstat,
  countFileLines,
} = require('../classify-audit-fix.cjs');

const DEFAULT_FILE_DETAILS = [
  { path: 'src/a.ts', additions: 3, deletions: 1, changedLinesKnown: true },
  { path: 'src/b.ts', additions: 0, deletions: 2, changedLinesKnown: true },
];

const DEFAULT_POLICY = {
  auditSafe: {
    allowedPathGlobs: ['src/**'],
    safeBranchPrefix: 'claude-audit-safe-fix-',
    manualBranchPrefix: 'claude-audit-fix-',
    safeLabels: ['auto-fix', 'audit-safe', 'skip-improve'],
    manualLabels: ['auto-fix', 'needs-review'],
  },
};

const GITHUB_CONTEXT = {
  repository: 'owner/repo',
  serverUrl: 'https://github.com',
};

// ---------------------------------------------------------------------------
// buildSourceRunUrl
// ---------------------------------------------------------------------------
test('buildSourceRunUrl returns full URL with all fields present', () => {
  const url = buildSourceRunUrl({
    runId: '12345',
    repository: 'owner/repo',
    serverUrl: 'https://github.com',
  });
  assert.equal(
    url,
    'https://github.com/owner/repo/actions/runs/12345',
  );
});

test('buildSourceRunUrl strips trailing slash from serverUrl', () => {
  const url = buildSourceRunUrl({
    runId: '99',
    repository: 'owner/repo',
    serverUrl: 'https://github.com/',
  });
  assert.equal(
    url,
    'https://github.com/owner/repo/actions/runs/99',
  );
});

test('buildSourceRunUrl returns empty for missing runId', () => {
  assert.equal(buildSourceRunUrl({ runId: '', repository: 'o/r', serverUrl: 'https://x.com' }), '');
  assert.equal(buildSourceRunUrl({ runId: null, repository: 'o/r', serverUrl: 'https://x.com' }), '');
  assert.equal(buildSourceRunUrl({ runId: undefined, repository: 'o/r', serverUrl: 'https://x.com' }), '');
});

test('buildSourceRunUrl returns empty for "local" runId', () => {
  assert.equal(buildSourceRunUrl({ runId: 'local', repository: 'o/r', serverUrl: 'https://x.com' }), '');
});

test('buildSourceRunUrl returns empty for missing repository', () => {
  assert.equal(buildSourceRunUrl({ runId: '1', repository: '', serverUrl: 'https://x.com' }), '');
  assert.equal(buildSourceRunUrl({ runId: '1', repository: null, serverUrl: 'https://x.com' }), '');
});

test('buildSourceRunUrl returns empty for missing serverUrl', () => {
  assert.equal(buildSourceRunUrl({ runId: '1', repository: 'o/r', serverUrl: '' }), '');
  assert.equal(buildSourceRunUrl({ runId: '1', repository: 'o/r', serverUrl: null }), '');
});

test('buildSourceRunUrl trims whitespace from inputs', () => {
  const url = buildSourceRunUrl({
    runId: '  42  ',
    repository: '  owner/repo  ',
    serverUrl: '  https://github.com  ',
  });
  assert.equal(
    url,
    'https://github.com/owner/repo/actions/runs/42',
  );
});

// ---------------------------------------------------------------------------
// buildBody — source run link in trigger and evidence
// ---------------------------------------------------------------------------
test('buildBody includes source-run link and omits bare Run ID when URL is available', () => {
  const body = buildBody({
    eligible: true,
    reason: 'matched audit-safe policy',
    runId: '42',
    fileDetails: DEFAULT_FILE_DETAILS,
    ...GITHUB_CONTEXT,
  });

  // buildAutomationPrBody renders a clickable "Source run:" link via renderLinks
  assert.ok(body.includes('Source run:'));
  assert.ok(body.includes('https://github.com/owner/repo/actions/runs/42'));
  // Evidence omits bare Run ID when sourceRunUrl is present
  assert.ok(!body.includes('Run ID: 42'));
});

test('buildBody shows bare Run ID in evidence when URL is unavailable', () => {
  const body = buildBody({
    eligible: false,
    reason: 'no changes',
    runId: 'local',
    fileDetails: [],
    ...GITHUB_CONTEXT,
  });

  // Evidence includes bare Run ID; no Source run link rendered
  assert.ok(body.includes('Run ID: local'));
  assert.ok(!body.includes('Source run:'));
});

test('buildBody includes Run ID in evidence when sourceRunUrl is empty', () => {
  const body = buildBody({
    eligible: false,
    reason: 'manual-only mode requested',
    runId: 'local',
    fileDetails: [],
    repository: '',
    serverUrl: '',
  });

  assert.ok(body.includes('Run ID: local'));
});

// ---------------------------------------------------------------------------
// classifyAuditFix — eligible path
// ---------------------------------------------------------------------------
test('classifyAuditFix marks eligible when files match audit-safe policy', () => {
  const result = classifyAuditFix({
    mode: 'auto',
    policy: DEFAULT_POLICY,
    runId: '100',
    fileDetails: DEFAULT_FILE_DETAILS,
    ...GITHUB_CONTEXT,
  });

  assert.equal(result.eligible, true);
  assert.ok(result.branch_name.startsWith('claude-audit-safe-fix-'));
  // Source run link rendered via buildAutomationPrBody renderLinks
  assert.ok(result.body.includes('Source run:'));
  assert.ok(result.body.includes('https://github.com/owner/repo/actions/runs/100'));
});

// ---------------------------------------------------------------------------
// classifyAuditFix — manual/ineligible paths
// ---------------------------------------------------------------------------
test('classifyAuditFix marks ineligible when mode is manual-only', () => {
  const result = classifyAuditFix({
    mode: 'manual-only',
    policy: DEFAULT_POLICY,
    runId: '101',
    fileDetails: DEFAULT_FILE_DETAILS,
    ...GITHUB_CONTEXT,
  });

  assert.equal(result.eligible, false);
  assert.ok(result.branch_name.startsWith('claude-audit-fix-'));
  assert.ok(result.body.includes('manual-only mode requested'));
});

test('classifyAuditFix marks ineligible when no file changes', () => {
  const result = classifyAuditFix({
    mode: 'auto',
    policy: DEFAULT_POLICY,
    runId: '102',
    fileDetails: [],
    ...GITHUB_CONTEXT,
  });

  assert.equal(result.eligible, false);
  assert.ok(result.reason.includes('no changes'));
});

test('classifyAuditFix passes sourceRunUrl through for eligible case', () => {
  const result = classifyAuditFix({
    mode: 'auto',
    policy: DEFAULT_POLICY,
    runId: '200',
    fileDetails: DEFAULT_FILE_DETAILS,
    ...GITHUB_CONTEXT,
  });

  // The PR body builder receives sourceRunUrl and renders a "Source run:" link
  assert.ok(result.body.includes('Source run:'));
  assert.ok(result.body.includes('https://github.com/owner/repo/actions/runs/200'));
});

test('classifyAuditFix omits source-run link for local runId', () => {
  const result = classifyAuditFix({
    mode: 'manual-only',
    policy: DEFAULT_POLICY,
    runId: 'local',
    fileDetails: DEFAULT_FILE_DETAILS,
    repository: '',
    serverUrl: '',
  });

  assert.ok(!result.body.includes('Source run:'));
  assert.ok(result.body.includes('Run ID: local'));
});

// ---------------------------------------------------------------------------
// classifyAuditFix — label and draft behavior
// ---------------------------------------------------------------------------
test('classifyAuditFix uses safe labels and non-draft for eligible', () => {
  const result = classifyAuditFix({
    mode: 'auto',
    policy: DEFAULT_POLICY,
    runId: '300',
    fileDetails: DEFAULT_FILE_DETAILS,
    ...GITHUB_CONTEXT,
  });

  assert.ok(result.labels.includes('audit-safe'));
  assert.equal(result.draft, 'false');
});

test('classifyAuditFix uses manual labels and draft for ineligible', () => {
  const result = classifyAuditFix({
    mode: 'manual-only',
    policy: DEFAULT_POLICY,
    runId: '301',
    fileDetails: DEFAULT_FILE_DETAILS,
    ...GITHUB_CONTEXT,
  });

  assert.ok(result.labels.includes('needs-review'));
  assert.equal(result.draft, 'true');
});

// ---------------------------------------------------------------------------
// parseNumstat
// ---------------------------------------------------------------------------
test('parseNumstat parses standard numstat output', () => {
  const result = parseNumstat('5\t2\tsrc/foo.ts\n0\t1\tsrc/bar.ts');
  assert.deepEqual(result, [
    { path: 'src/foo.ts', additions: 5, deletions: 2, changedLinesKnown: true },
    { path: 'src/bar.ts', additions: 0, deletions: 1, changedLinesKnown: true },
  ]);
});

test('parseNumstat handles binary files', () => {
  const result = parseNumstat('-\t-\timage.png');
  assert.deepEqual(result, [
    { path: 'image.png', additions: 0, deletions: 0, changedLinesKnown: false },
  ]);
});

test('parseNumstat returns empty array for empty input', () => {
  assert.deepEqual(parseNumstat(''), []);
  assert.deepEqual(parseNumstat(null), []);
  assert.deepEqual(parseNumstat(undefined), []);
});

test('parseNumstat filters blank lines', () => {
  const result = parseNumstat('1\t1\ta.ts\n\n2\t2\tb.ts\n');
  assert.equal(result.length, 2);
});

test('parseNumstat handles paths with tabs', () => {
  const result = parseNumstat('1\t0\tfile\tname.ts');
  assert.equal(result[0].path, 'file\tname.ts');
});

// ---------------------------------------------------------------------------
// countFileLines
// ---------------------------------------------------------------------------
test('countFileLines returns 0 for empty buffer', () => {
  const tmp = require('node:fs').mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'caf-test-'),
  );
  const file = require('node:path').join(tmp, 'empty.txt');
  require('node:fs').writeFileSync(file, '');
  assert.equal(countFileLines(file), 0);
  require('node:fs').rmSync(tmp, { recursive: true });
});

test('countFileLines counts single line without trailing newline', () => {
  const tmp = require('node:fs').mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'caf-test-'),
  );
  const file = require('node:path').join(tmp, 'one.txt');
  require('node:fs').writeFileSync(file, 'hello');
  assert.equal(countFileLines(file), 1);
  require('node:fs').rmSync(tmp, { recursive: true });
});

test('countFileLines counts multiple lines with trailing newline', () => {
  const tmp = require('node:fs').mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'caf-test-'),
  );
  const file = require('node:path').join(tmp, 'lines.txt');
  require('node:fs').writeFileSync(file, 'a\nb\nc\n');
  assert.equal(countFileLines(file), 3);
  require('node:fs').rmSync(tmp, { recursive: true });
});
