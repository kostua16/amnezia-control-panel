/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LOG_TITLE,
  LOG_SEARCH_MARKER,
  GENERIC_DISPOSITION_TOKENS,
  fingerprint,
  isActionableSummary,
  extractRecommendations,
  parseStructuredOutput,
  parseLogBody,
  buildLogBody,
  trimEntries,
  escalationTitle,
  escalationSearchQuery,
  hasMergedFixPr,
  countConsecutive,
  hasRunEntry,
  runAudit,
  main,
} = require('../escalate-repeated-fixes.cjs');

// --- fingerprint ---

test('fingerprint is deterministic and normalizes whitespace', () => {
  const a = fingerprint('Add  input  validation to   all API routes');
  const b = fingerprint('add input validation to all api routes');
  assert.equal(a, b);
  assert.equal(a.length, 12);
});

test('fingerprint differs for distinct recommendations', () => {
  const a = fingerprint('Fix auth middleware token check');
  const b = fingerprint('Add rate limiting to public endpoints');
  assert.notEqual(a, b);
});

test('fingerprint handles empty and null input', () => {
  assert.equal(fingerprint(''), fingerprint(null));
  assert.equal(fingerprint(''), fingerprint(undefined));
});

// --- extractRecommendations ---
// Live audit run 31294899310 emitted per-PR dispositions (merge/close/review)
// plus risk_patterns. Those tokens fingerprint as the false APR-E10 issues
// #1061 / #1062 / #1080. The extractor must ignore that shape entirely.

const LIVE_FALSE_ESCALATION_FPS = {
  merge: '283128acef14',
  close: '310ff200149b',
  review: 'c97ace4c8fef',
};

const liveAudit31294899310 = {
  summary: 'Inspected automation PRs; dispositions only.',
  auto_prs_inspected: [
    {
      number: 101,
      title: 'ci: ready',
      branch: 'auto/a',
      author: 'github-actions[bot]',
      evidence: 'checks green',
      recommendation: 'merge',
    },
    {
      number: 102,
      title: 'ci: superseded',
      branch: 'auto/b',
      author: 'github-actions[bot]',
      evidence: 'replaced',
      recommendation: 'close',
    },
    {
      number: 103,
      title: 'ci: needs eyes',
      branch: 'auto/c',
      author: 'github-actions[bot]',
      evidence: 'overlap',
      recommendation: 'review',
    },
  ],
  risk_patterns: [
    'duplicate auto-PRs editing the same helper',
    'stale automation branches',
  ],
  human_disposition: [
    { number: 101, action: 'merge', reason: 'ready' },
    { number: 102, action: 'close', reason: 'superseded' },
    { number: 103, action: 'review', reason: 'overlap' },
  ],
  systemic_fix_made: false,
  verification: [],
  no_new_pr_reason: 'disposition only',
};

test('live disposition tokens still fingerprint as the false APR-E10 issues', () => {
  for (const [token, fp] of Object.entries(LIVE_FALSE_ESCALATION_FPS)) {
    assert.equal(fingerprint(token), fp, token);
    assert.equal(GENERIC_DISPOSITION_TOKENS.has(token), true);
    assert.equal(isActionableSummary(token), false);
  }
});

test('extractRecommendations ignores live merge/close/review plus risk output', () => {
  assert.deepEqual(extractRecommendations(liveAudit31294899310), []);
  assert.deepEqual(
    extractRecommendations({
      ...liveAudit31294899310,
      systemic_fix_recommendations: [],
    }),
    [],
  );
});

test('extractRecommendations consumes only systemic_fix_recommendations objects', () => {
  const data = {
    auto_prs_inspected: [
      {
        number: 1,
        recommendation: 'Add shared helper for branch cleanup',
      },
    ],
    risk_patterns: ['Orphan branches accumulating from failed runs'],
    systemic_fix_recommendations: [
      {
        summary: 'Add shared helper for branch cleanup',
        evidence: 'PRs #1 and #2 copy the same cleanup block',
      },
    ],
  };
  const recs = extractRecommendations(data);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].text, 'Add shared helper for branch cleanup');
  assert.equal(
    recs[0].fingerprint,
    fingerprint('Add shared helper for branch cleanup'),
  );
});

test('extractRecommendations treats missing old schema as no recommendations', () => {
  const data = {
    auto_prs_inspected: [{ number: 1, recommendation: 'merge' }],
    risk_patterns: ['stale branches'],
  };
  assert.equal(extractRecommendations(data).length, 0);
  assert.equal(extractRecommendations({}).length, 0);
  assert.equal(
    extractRecommendations({ systemic_fix_recommendations: null }).length,
    0,
  );
});

test('extractRecommendations rejects generic tokens, empty summaries, and malformed entries', () => {
  const data = {
    systemic_fix_recommendations: [
      { summary: 'merge' },
      { summary: 'CLOSE' },
      { summary: ' review ' },
      { summary: 'rebase' },
      { summary: 'block' },
      { summary: 'none' },
      { summary: '-' },
      { summary: '' },
      { summary: '   ' },
      { summary: null },
      { evidence: 'no summary field' },
      'bare string is not an object',
      12,
      null,
      ['Add a shared retry helper'],
      {
        summary: 'Add a shared retry helper',
        evidence: 'seen on two audit PRs',
      },
      {
        summary: '  Add   a shared retry helper  ',
        evidence: 'duplicate after normalize',
      },
    ],
  };
  const recs = extractRecommendations(data);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].text, 'Add a shared retry helper');
});

test('extractRecommendations fingerprints the summary only, not evidence', () => {
  const summary = 'Centralize workflow retry policy';
  const recs = extractRecommendations({
    systemic_fix_recommendations: [
      { summary, evidence: 'PR #11' },
      { summary, evidence: 'different PR #22 must not split the streak' },
    ],
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].fingerprint, fingerprint(summary));
  assert.equal(recs[0].text, summary);
  assert.equal(recs[0].evidence, undefined);
});

// --- parseStructuredOutput ---

test('parseStructuredOutput handles empty, null, invalid', () => {
  assert.equal(parseStructuredOutput(''), null);
  assert.equal(parseStructuredOutput(null), null);
  assert.equal(parseStructuredOutput('not json'), null);
  assert.deepEqual(parseStructuredOutput('{"a":1}'), { a: 1 });
});

// --- parseLogBody ---

test('parseLogBody extracts JSON from markers', () => {
  const body = [
    '## Some header',
    '<!-- log-start -->',
    '[{"run_id":"r1","recommendations":[{"fingerprint":"abc123","text":"fix X"}]}]',
    '<!-- log-end -->',
    '## Footer',
  ].join('\n');
  const entries = parseLogBody(body);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].run_id, 'r1');
});

test('parseLogBody returns empty for missing markers', () => {
  assert.deepEqual(parseLogBody('no markers here'), []);
  assert.deepEqual(parseLogBody(''), []);
});

// --- buildLogBody ---

test('buildLogBody includes markers and JSON', () => {
  const entries = [
    { run_id: 'r1', timestamp: '2026-01-01', recommendations: [] },
  ];
  const body = buildLogBody(entries, 'https://github.com/o/r', 'https://run');
  assert.ok(body.includes('<!-- log-start -->'));
  assert.ok(body.includes('<!-- log-end -->'));
  assert.ok(body.includes('"run_id":"r1"'));
  assert.ok(body.includes('APR-E10'));
});

test('buildLogBody escapes marker-like recommendation text and round-trips it', () => {
  const markerText = 'Preserve <!-- log-end --> as literal recommendation text';
  const entries = [
    {
      run_id: 'r1',
      recommendations: [
        { fingerprint: fingerprint(markerText), text: markerText },
      ],
    },
  ];

  const body = buildLogBody(entries, 'https://github.com/o/r', 'https://run');

  assert.equal((body.match(/<!-- log-end -->/g) || []).length, 1);
  assert.deepEqual(parseLogBody(body), entries);
});

// --- trimEntries ---

test('trimEntries keeps entries within limit', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ run_id: String(i) }));
  assert.equal(trimEntries(entries).length, 5);
});

test('trimEntries trims to MAX_LOG_ENTRIES', () => {
  const entries = Array.from({ length: 25 }, (_, i) => ({ run_id: String(i) }));
  const trimmed = trimEntries(entries);
  assert.equal(trimmed.length, 20);
  // Should keep the last 20 (most recent)
  assert.equal(trimmed[0].run_id, '5');
  assert.equal(trimmed[trimmed.length - 1].run_id, '24');
});

// --- escalation dedup (APR-E10) ---
// findEscalationIssue searches the title for the fingerprint, so the title
// built by createEscalationIssue must contain it. The two builders below share
// a single source of truth so the create/find round-trip cannot desynchronize.

test('escalationTitle embeds the fingerprint so the in:title dedup search round-trips', () => {
  const fp = fingerprint('Add input validation to all API routes');
  const title = escalationTitle(fp, 'Add input validation to all API routes');
  assert.ok(
    title.includes(fp),
    `title must contain the fp so findEscalationIssue matches it; got: ${title}`,
  );
  // Regression guard: the prior title omitted the fp, silently breaking dedup.
  assert.ok(!title.startsWith('APR-E10 escalate:'));
});

test('escalationSearchQuery references the same fingerprint the title embeds', () => {
  const fp = 'deadbeef0123';
  const title = escalationTitle(fp, 'some systemic fix');
  const query = escalationSearchQuery(fp);
  assert.ok(title.includes(fp), `title must embed fp; got: ${title}`);
  assert.ok(query.includes(fp), `query must reference fp; got: ${query}`);
  assert.ok(query.includes('in:title'));
});

// --- hasMergedFixPr (regression guard) ---
// The gh runner is injected so the empty-result path can be exercised without
// shelling out. `--jq length` yields "0" on no match; previously the raw "[]"
// made the truthiness check always true and skipped every escalation.

test('hasMergedFixPr returns false when no merged PR matches', () => {
  let args;
  assert.equal(
    hasMergedFixPr('o/r', 'abc123', (received) => {
      args = received;
      return '0';
    }),
    false,
  );
  assert.deepEqual(args.slice(-4), ['--json', 'number', '--jq', 'length']);
});

test('hasMergedFixPr returns true when at least one merged PR matches', () => {
  assert.equal(
    hasMergedFixPr('o/r', 'abc123', () => '2'),
    true,
  );
});

test('hasMergedFixPr suppresses a merged PR that closes the escalation issue', () => {
  const calls = [];
  assert.equal(
    hasMergedFixPr('o/r', 'abc123', 417, (args) => {
      calls.push(args);
      if (calls.length === 1) return '0';
      return JSON.stringify([
        { number: 99, body: 'Fixes #417 by adding the shared gate.' },
      ]);
    }),
    true,
  );
  assert.match(calls[1][calls[1].indexOf('--search') + 1], /#417/);
});

test('hasMergedFixPr propagates gh failures so issue creation stops safely', () => {
  assert.throws(
    () =>
      hasMergedFixPr('o/r', 'abc123', () => {
        throw new Error('gh not installed');
      }),
    /gh not installed/,
  );
});

// --- log-issue marker round-trip (regression guard) ---
// findLogIssue searches issue titles with LOG_SEARCH_MARKER. The title written
// by upsertLogIssue (LOG_TITLE) must contain each search term verbatim, or
// matching depends on how GitHub tokenizes hyphens — the prior marker used the
// hyphenated token `auto-pr-audit` while the title spells it space-separated,
// so the search never matched and a fresh log issue was created every run.

test('every LOG_SEARCH_MARKER term appears literally in LOG_TITLE', () => {
  const titleLower = LOG_TITLE.toLowerCase();
  const markerTerms = LOG_SEARCH_MARKER.replace(/\bin:title\b/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const term of markerTerms) {
    assert.ok(
      titleLower.includes(term.toLowerCase()),
      `search term "${term}" must appear in the title so the in:title search round-trips; title: "${LOG_TITLE}"`,
    );
  }
});

test('LOG_SEARCH_MARKER scopes the search to issue titles', () => {
  assert.ok(LOG_SEARCH_MARKER.includes('in:title'));
});

// --- countConsecutive (streak threshold regression guard) ---
// The ≥2-consecutive-runs escalation gate (main: count >= 2) depends on this
// walk. A future refactor could silently change "consecutive" semantics; these
// pin first run, trailing run, gap reset, and interleaved fingerprints.

const fpEntry = (...fps) => ({
  run_id: 'r',
  recommendations: fps.map((f) => ({ fingerprint: f })),
});

test('countConsecutive returns 0 for empty entries', () => {
  assert.equal(countConsecutive([], 'abc'), 0);
});

test('countConsecutive counts a full trailing run', () => {
  const entries = [fpEntry('abc'), fpEntry('abc'), fpEntry('abc')];
  assert.equal(countConsecutive(entries, 'abc'), 3);
});

test('countConsecutive resets to 0 when the latest entry lacks the fp', () => {
  const entries = [fpEntry('abc'), fpEntry('abc'), fpEntry('zzz')];
  assert.equal(countConsecutive(entries, 'abc'), 0);
});

test('countConsecutive stops at the first gap', () => {
  const entries = [fpEntry('abc'), fpEntry('zzz'), fpEntry('abc')];
  assert.equal(countConsecutive(entries, 'abc'), 1);
});

test('countConsecutive does not cross-count interleaved fingerprints', () => {
  const entries = [
    fpEntry('abc', 'def'),
    fpEntry('abc'),
    fpEntry('def', 'abc'),
  ];
  assert.equal(countConsecutive(entries, 'abc'), 3);
  assert.equal(countConsecutive(entries, 'def'), 1);
});

test('countConsecutive tolerates a malformed entry', () => {
  const entries = [{ run_id: 'r' }, fpEntry('abc')];
  assert.equal(countConsecutive(entries, 'abc'), 1);
});

test('hasRunEntry prevents one workflow retry from counting as another audit', () => {
  const entries = [{ run_id: '123' }, { run_id: '456' }];
  assert.equal(hasRunEntry(entries, '456'), true);
  assert.equal(hasRunEntry(entries, 456), true);
  assert.equal(hasRunEntry(entries, '789'), false);
});

function createAuditHarness() {
  let entries = [];
  let failNextCreate = false;
  const created = [];
  const outputs = {};
  return {
    api: {
      findLogIssue: () => (entries.length > 0 ? 10 : null),
      readLogBody: () => buildLogBody(entries, 'https://github.com/o/r', ''),
      upsertLogIssue: (_repo, _number, nextEntries) => {
        entries = structuredClone(nextEntries);
      },
      findEscalationIssue: () => null,
      hasMergedFixPr: () => false,
      createEscalationIssue: (_repo, fp) => {
        if (failNextCreate) {
          failNextCreate = false;
          throw new Error('issue create failed');
        }
        created.push(fp);
      },
      setOutput: (name, value) => {
        outputs[name] = value;
      },
      now: () => new Date('2026-08-08T00:00:00Z'),
      write: () => {},
    },
    created,
    entries: () => entries,
    failCreateOnce: () => {
      failNextCreate = true;
    },
    outputs,
  };
}

const auditOutput = (recommendation) =>
  JSON.stringify({
    auto_prs_inspected: [],
    risk_patterns: [],
    systemic_fix_recommendations: recommendation
      ? [{ summary: recommendation }]
      : [],
  });

test('runAudit records clean audits so they reset recommendation streaks', () => {
  const harness = createAuditHarness();
  runAudit(
    {
      repo: 'o/r',
      runUrl: 'https://github.com/o/r/actions/runs/1',
      rawOutput: auditOutput('Add a shared retry helper'),
    },
    harness.api,
  );
  runAudit(
    {
      repo: 'o/r',
      runUrl: 'https://github.com/o/r/actions/runs/2',
      rawOutput: auditOutput(null),
    },
    harness.api,
  );
  runAudit(
    {
      repo: 'o/r',
      runUrl: 'https://github.com/o/r/actions/runs/3',
      rawOutput: auditOutput('Add a shared retry helper'),
    },
    harness.api,
  );

  assert.equal(harness.entries().length, 3);
  assert.deepEqual(harness.entries()[1].recommendations, []);
  assert.deepEqual(harness.created, []);
});

test('runAudit resumes escalation when a retry finds its persisted run entry', () => {
  const harness = createAuditHarness();
  const recommendation = 'Add a shared retry helper';
  runAudit(
    {
      repo: 'o/r',
      runUrl: 'https://github.com/o/r/actions/runs/1',
      rawOutput: auditOutput(recommendation),
    },
    harness.api,
  );
  harness.failCreateOnce();
  assert.throws(
    () =>
      runAudit(
        {
          repo: 'o/r',
          runUrl: 'https://github.com/o/r/actions/runs/2',
          rawOutput: auditOutput(recommendation),
        },
        harness.api,
      ),
    /issue create failed/,
  );

  runAudit(
    {
      repo: 'o/r',
      runUrl: 'https://github.com/o/r/actions/runs/2',
      rawOutput: auditOutput(recommendation),
    },
    harness.api,
  );

  assert.equal(harness.entries().length, 2);
  assert.deepEqual(harness.created, [fingerprint(recommendation)]);
  assert.equal(harness.outputs.escalated_count, '1');
});

test('main binds CLI arguments and escalates the second consecutive audit', () => {
  const harness = createAuditHarness();
  const recommendation = 'Centralize workflow retry policy';
  const invoke = (runId) =>
    main({
      argv: [
        'node',
        'escalate-repeated-fixes.cjs',
        '--repo',
        'o/r',
        '--run-url',
        `https://github.com/o/r/actions/runs/${runId}`,
        '--structured-output',
        auditOutput(recommendation),
        '--github-output',
        '/tmp/github-output',
      ],
      apiOverrides: harness.api,
    });

  assert.equal(invoke(1).escalated, 0);
  assert.equal(invoke(2).escalated, 1);
  assert.deepEqual(harness.created, [fingerprint(recommendation)]);
});

test('audit workflow runs APR-E10 with its structured output', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '..', 'audit-auto-prs.yml'),
    'utf8',
  );
  assert.match(
    workflow,
    /node \.github\/workflows\/scripts\/escalate-repeated-fixes\.cjs/,
  );
  assert.match(
    workflow,
    /STRUCTURED_OUTPUT: \$\{\{ needs\.audit-auto-prs\.outputs\.structured_output \}\}/,
  );
});

test('audit workflow schema requires systemic_fix_recommendations objects only', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '..', 'audit-auto-prs.yml'),
    'utf8',
  );
  const match = workflow.match(/json-schema:\s+'(\{.*\})'/);
  assert.ok(match, 'expected json-schema on run-zai');
  const schema = JSON.parse(match[1]);
  assert.ok(
    schema.required.includes('systemic_fix_recommendations'),
    'schema must require the explicit systemic-fix array',
  );
  const recSchema = schema.properties.systemic_fix_recommendations;
  assert.equal(recSchema.type, 'array');
  assert.equal(recSchema.items.type, 'object');
  assert.deepEqual(recSchema.items.required, ['summary']);
  assert.equal(recSchema.items.additionalProperties, false);
  assert.ok(recSchema.items.properties.summary);
  assert.ok(recSchema.items.properties.evidence);
});

test('runAudit does not escalate live disposition-only output across consecutive runs', () => {
  const harness = createAuditHarness();
  const raw = JSON.stringify(liveAudit31294899310);
  runAudit(
    {
      repo: 'o/r',
      runUrl: 'https://github.com/o/r/actions/runs/31294899310',
      rawOutput: raw,
    },
    harness.api,
  );
  runAudit(
    {
      repo: 'o/r',
      runUrl: 'https://github.com/o/r/actions/runs/31294899311',
      rawOutput: raw,
    },
    harness.api,
  );
  assert.equal(harness.entries().length, 2);
  assert.deepEqual(harness.entries()[0].recommendations, []);
  assert.deepEqual(harness.entries()[1].recommendations, []);
  assert.deepEqual(harness.created, []);
});

test('runAudit escalates two consecutive explicit systemic recommendations', () => {
  const harness = createAuditHarness();
  const recommendation =
    'Require systemic_fix_recommendations in the audit contract';
  assert.equal(
    runAudit(
      {
        repo: 'o/r',
        runUrl: 'https://github.com/o/r/actions/runs/1',
        rawOutput: auditOutput(recommendation),
      },
      harness.api,
    ).escalated,
    0,
  );
  assert.equal(
    runAudit(
      {
        repo: 'o/r',
        runUrl: 'https://github.com/o/r/actions/runs/2',
        rawOutput: auditOutput(recommendation),
      },
      harness.api,
    ).escalated,
    1,
  );
  assert.deepEqual(harness.created, [fingerprint(recommendation)]);
});

test('runAudit treats a mixed invalid/valid batch as one normalized recommendation', () => {
  const harness = createAuditHarness();
  const raw = JSON.stringify({
    ...liveAudit31294899310,
    systemic_fix_recommendations: [
      { summary: 'merge' },
      { summary: 'close' },
      { summary: '  Pin retry policy in one helper  ' },
      { summary: 'Pin retry policy in one helper' },
    ],
  });
  runAudit(
    {
      repo: 'o/r',
      runUrl: 'https://github.com/o/r/actions/runs/8',
      rawOutput: raw,
    },
    harness.api,
  );
  const recs = harness.entries()[0].recommendations;
  assert.equal(recs.length, 1);
  assert.equal(recs[0].text, 'Pin retry policy in one helper');
  assert.equal(
    recs[0].fingerprint,
    fingerprint('Pin retry policy in one helper'),
  );
  assert.deepEqual(harness.created, []);
});
