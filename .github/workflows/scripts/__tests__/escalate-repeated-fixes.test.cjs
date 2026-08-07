/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fingerprint,
  extractRecommendations,
  parseStructuredOutput,
  parseLogBody,
  buildLogBody,
  trimEntries,
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

test('extractRecommendations pulls from auto_prs_inspected', () => {
  const data = {
    auto_prs_inspected: [
      {
        number: 1,
        title: 'T',
        branch: 'b',
        author: 'bot',
        evidence: 'e',
        recommendation: 'Add shared helper for branch cleanup',
      },
      {
        number: 2,
        title: 'T2',
        branch: 'b2',
        author: 'bot2',
        evidence: 'e2',
        recommendation: '-',
      },
    ],
    risk_patterns: [],
  };
  const recs = extractRecommendations(data);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].text, 'Add shared helper for branch cleanup');
});

test('extractRecommendations skips placeholder recommendations', () => {
  const data = {
    auto_prs_inspected: [
      { number: 1, recommendation: 'none' },
      { number: 2, recommendation: '' },
      { number: 3, recommendation: null },
    ],
    risk_patterns: [],
  };
  assert.equal(extractRecommendations(data).length, 0);
});

test('extractRecommendations deduplicates across sources', () => {
  const rec = 'Use fleet back-pressure gate on all scheduled workflows';
  const data = {
    auto_prs_inspected: [{ number: 1, recommendation: rec }],
    risk_patterns: [rec],
  };
  assert.equal(extractRecommendations(data).length, 1);
});

test('extractRecommendations also pulls from risk_patterns', () => {
  const data = {
    auto_prs_inspected: [],
    risk_patterns: ['Orphan branches accumulating from failed runs'],
  };
  const recs = extractRecommendations(data);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].text, 'Orphan branches accumulating from failed runs');
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
