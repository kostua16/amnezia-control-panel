#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

/**
 * APR-E10: Escalate twice-recommended systemic fixes to tracking issues.
 *
 * Persists audit recommendations to a GitHub issue (recommendation log).
 * If the same systemic fix is recommended in ≥2 consecutive audits without
 * a merged PR, opens a dedicated tracking issue so the pattern stops relying
 * on PR luck.
 *
 * Usage (CI):
 *   node escalate-repeated-fixes.cjs \
 *     --repo owner/repo \
 *     --structured-output "$STRUCTURED_OUTPUT" \
 *     --run-url "$RUN_URL" \
 *     [--github-output "$GITHUB_OUTPUT"]
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');

const LOG_TITLE = 'Auto PR Audit: systemic-fix recommendation log (APR-E10)';
const LOG_LABELS = ['auto-fix'];
// Every search term here appears literally in LOG_TITLE. The prior marker used
// the hyphenated token `auto-pr-audit`, but the title spells it `Auto PR Audit`
// space-separated; if GitHub's search indexer does not split hyphens into
// tokens, that term never matched and findLogIssue returned null every run
// (duplicate log issues, streaks never accumulated past 1, APR-E10 never
// escalated). `recommendation`, `log`, and `APR-E10` are present verbatim in
// the title, so matching no longer depends on hyphen tokenization.
const LOG_SEARCH_MARKER = 'recommendation log APR-E10 in:title';

const ESCALATION_LABELS = ['auto-fix', 'needs-review', 'umbrella-sub-issue'];
const MAX_LOG_ENTRIES = 20;

function getArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? '';
}

function runGh(args, input) {
  const stdio = ['pipe', 'pipe', 'pipe'];
  return execFileSync('gh', args, {
    input: input || '',
    stdio,
    encoding: 'utf8',
  }).trim();
}

function setOutput(name, value, outputPath) {
  const ghaFile = outputPath || process.env.GITHUB_OUTPUT;
  if (!ghaFile) return;
  const { appendFileSync } = require('fs');
  appendFileSync(ghaFile, `${name}=${value}\n`);
}

function parseStructuredOutput(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Deterministic fingerprint for a recommendation string.
 * Normalizes whitespace and lowercases so minor wording diffs don't split.
 */
function fingerprint(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Extract unique recommendation fingerprints from structured output.
 * Sources: `auto_prs_inspected[].recommendation` + `risk_patterns[]`.
 */
function extractRecommendations(data) {
  const seen = new Set();
  const recs = [];

  const inspected = Array.isArray(data.auto_prs_inspected)
    ? data.auto_prs_inspected
    : [];
  for (const pr of inspected) {
    const rec = pr && pr.recommendation;
    if (!rec || rec === '-' || rec === 'none') continue;
    const fp = fingerprint(rec);
    if (!seen.has(fp)) {
      seen.add(fp);
      recs.push({ fingerprint: fp, text: String(rec).trim() });
    }
  }

  const risks = Array.isArray(data.risk_patterns) ? data.risk_patterns : [];
  for (const r of risks) {
    if (!r) continue;
    const fp = fingerprint(r);
    if (!seen.has(fp)) {
      seen.add(fp);
      recs.push({ fingerprint: fp, text: String(r).trim() });
    }
  }

  return recs;
}

function findLogIssue(repo) {
  const out = runGh([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--search',
    LOG_SEARCH_MARKER,
    '--json',
    'number,body',
    '--jq',
    '.[0].number // empty',
  ]);
  const num = parseInt(out, 10);
  return Number.isNaN(num) ? null : num;
}

function readLogBody(repo, issueNum) {
  return runGh([
    'issue',
    'view',
    String(issueNum),
    '--repo',
    repo,
    '--json',
    'body',
    '--jq',
    '.body',
  ]);
}

function parseLogBody(body) {
  if (!body) return [];
  // Extract JSON from between <!-- log-start --> and <!-- log-end --> markers
  const startMarker = '<!-- log-start -->';
  const endMarker = '<!-- log-end -->';
  const startIdx = body.indexOf(startMarker);
  const endIdx = body.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return [];
  const jsonStr = body.slice(startIdx + startMarker.length, endIdx).trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    return [];
  }
}

function buildLogBody(entries, repoUrl, runUrl) {
  const lines = [
    '## Systemic Fix Recommendation Log (APR-E10)',
    '',
    `> Last updated: ${new Date().toISOString().split('T')[0]} — [audit run](${runUrl})`,
    '',
    'Tracks systemic-fix recommendations across audit runs. When the same fix is recommended in ≥2 runs without a merged PR, an escalation issue is opened automatically.',
    '',
    '<!-- log-start -->',
    // Keep free-form text from introducing HTML-comment delimiters. JSON.parse
    // decodes the Unicode escape back to the original recommendation text.
    JSON.stringify(entries).replaceAll('<', '\\u003c'),
    '<!-- log-end -->',
  ];
  return lines.join('\n');
}

function upsertLogIssue(repo, existingNum, entries, runUrl) {
  const repoUrl = `https://github.com/${repo}`;
  const body = buildLogBody(entries, repoUrl, runUrl);
  // Reuse the issue number main() already resolved. Only fall back to a fresh
  // search when no number was supplied, so the normal path makes one `gh issue
  // list` call per run instead of two (the second call also opened a TOCTOU
  // window where a concurrent edit could change which issue was found).
  const existing = existingNum != null ? existingNum : findLogIssue(repo);

  if (existing != null) {
    runGh(
      ['issue', 'edit', String(existing), '--repo', repo, '--body-file', '-'],
      body,
    );
    return existing;
  }

  runGh([
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    LOG_TITLE,
    '--body',
    body,
    '--label',
    LOG_LABELS.join(','),
  ]);
  return null; // newly created, number unknown from stdout
}

/**
 * Escalation issue title. The fingerprint is embedded in the title so the
 * dedup search (escalationSearchQuery) can find this issue again on later
 * runs. Without it the search never matched and a duplicate escalation was
 * opened on every audit run.
 */
function escalationTitle(fp, shortDesc) {
  return `APR-E10 escalate [${fp}]: ${shortDesc}`;
}

/**
 * Search query used to locate an existing escalation issue. The quoted
 * fingerprint is an exact phrase that matches the `[${fp}]` token written
 * into the title by escalationTitle(). Deriving both from the same source
 * keeps the create/find round-trip from silently desynchronizing.
 */
function escalationSearchQuery(fp) {
  return `APR-E10 escalate "${fp}" in:title`;
}

/**
 * Check whether an open escalation issue already exists for a fingerprint.
 */
function findEscalationIssue(repo, fp, state = 'open') {
  const out = runGh([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    state,
    '--search',
    escalationSearchQuery(fp),
    '--json',
    'number',
    '--jq',
    '.[0].number // empty',
  ]);
  const num = parseInt(out, 10);
  return Number.isNaN(num) ? null : num;
}

/**
 * Check whether a merged PR mentions the recommendation fingerprint or closes
 * the prior escalation issue. This is a best-effort heuristic.
 *
 * Uses `--jq length` so an empty result list is distinguishable from a hit:
 * with `--json number` gh emits the literal `[]` (a 2-char string) when
 * nothing matches, so the previous `out.length > 0` check was true for both
 * "no merged PR" and "found one" — every fingerprint was treated as already
 * fixed and escalation never fired. `length` yields `0` on no match and the
 * match count otherwise, so `parseInt(out, 10) > 0` is correct in both cases.
 *
 * The gh runner is injectable purely so the empty-result path can be
 * exercised by unit tests without shelling out.
 */
function hasMergedFixPr(repo, fp, issueNumOrRunner, runGhFn) {
  const issueNum =
    typeof issueNumOrRunner === 'function' ? null : issueNumOrRunner;
  const runner =
    typeof issueNumOrRunner === 'function'
      ? issueNumOrRunner
      : runGhFn || runGh;
  const out = runner([
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'merged',
    '--search',
    `"APR-E10" ${fp}`,
    '--json',
    'number',
    '--jq',
    'length',
  ]);
  if (parseInt(out, 10) > 0) return true;
  if (issueNum == null) return false;

  const issueReference = `#${issueNum}`;
  const candidates = runner([
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'merged',
    '--search',
    `${issueReference} in:body`,
    '--limit',
    '100',
    '--json',
    'number,body',
  ]);
  const prs = JSON.parse(candidates);
  const escapedIssue = issueReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const closesIssue = new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+${escapedIssue}\\b`,
    'i',
  );
  return prs.some((pr) => closesIssue.test(String(pr.body || '')));
}

function createEscalationIssue(repo, fp, description, count, runUrl) {
  const repoUrl = `https://github.com/${repo}`;
  const body = [
    '## Escalated Systemic Fix (APR-E10)',
    '',
    `The same systemic fix has been recommended in **${count} consecutive audit runs** without a merged PR addressing it.`,
    '',
    '### Recommendation',
    '',
    `> ${description}`,
    '',
    '### Evidence',
    '',
    `- Fingerprint: \`${fp}\``,
    `- Consecutive runs: ${count}`,
    `- Latest run: [audit](${runUrl})`,
    '',
    '### Next Steps',
    '',
    '1. Implement the systemic fix in a dedicated PR.',
    '2. Reference this issue and the fingerprint in the PR body.',
    '3. Once merged, the recommendation log will stop escalating this fix.',
    '',
    '---',
    `Escalated automatically by the audit-auto-prs workflow ([run](${runUrl})).`,
  ].join('\n');

  // Short title: first 72 chars of the recommendation
  const shortDesc =
    description.length > 72 ? `${description.slice(0, 69)}...` : description;
  const title = escalationTitle(fp, shortDesc);

  runGh([
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    title,
    '--body',
    body,
    '--label',
    ESCALATION_LABELS.join(','),
  ]);
}

/**
 * Trim the log to the most recent MAX_LOG_ENTRIES entries.
 */
function trimEntries(entries) {
  if (entries.length <= MAX_LOG_ENTRIES) return entries;
  return entries.slice(entries.length - MAX_LOG_ENTRIES);
}

/**
 * Count consecutive trailing log entries that contain a fingerprint.
 *
 * Walks entries backward from the most recent and stops at the first entry
 * lacking the fingerprint, so a gap resets the streak to the run before it.
 * Returns 0 when the latest entry lacks the fingerprint (no active streak).
 *
 * This is the heart of the ≥2-consecutive-runs escalation gate, extracted as a
 * pure function so its semantics can be pinned by unit tests — the same surface
 * class as the two silent-failure regressions already guarded by tests
 * (escalation title round-trip and merged-PR length check).
 */
function countConsecutive(entries, fp) {
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const recs = (entry && entry.recommendations) || [];
    if (recs.some((r) => r.fingerprint === fp)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function hasRunEntry(entries, runId) {
  return entries.some((entry) => String(entry?.run_id) === String(runId));
}

function runAudit(
  { repo, runUrl = '', rawOutput = '', outputPath = '' },
  apiOverrides = {},
) {
  const api = {
    findLogIssue,
    readLogBody,
    upsertLogIssue,
    findEscalationIssue,
    hasMergedFixPr,
    createEscalationIssue,
    setOutput,
    now: () => new Date(),
    write: (message) => process.stdout.write(message),
    ...apiOverrides,
  };
  const data = parseStructuredOutput(rawOutput);
  if (!data) {
    api.write('No structured output — skipping APR-E10.\n');
    return { status: 'invalid-output', escalated: 0, entries: [] };
  }

  let recommendations = extractRecommendations(data);
  const runId = runUrl.split('/').pop() || String(api.now().getTime());
  const newEntry = {
    run_id: runId,
    timestamp: api.now().toISOString(),
    recommendations: recommendations.map((r) => ({
      fingerprint: r.fingerprint,
      text: r.text,
    })),
  };

  // Read prior log
  const existingNum = api.findLogIssue(repo);
  let entries = [];
  if (existingNum != null) {
    const body = api.readLogBody(repo, existingNum);
    entries = parseLogBody(body);
  }

  const persistedEntry = entries.find(
    (entry) => String(entry?.run_id) === String(runId),
  );
  if (persistedEntry) {
    // A retry must not append another audit, but it must resume work that may
    // have failed after the log write (for example, escalation issue creation).
    recommendations = Array.isArray(persistedEntry.recommendations)
      ? persistedEntry.recommendations
      : [];
    api.write(`Audit run ${runId} is already logged — resuming.\n`);
  } else {
    // Clean audits are deliberately persisted: an empty recommendation list is
    // the gap that resets every active consecutive-run streak.
    entries.push(newEntry);
    entries = trimEntries(entries);
    api.upsertLogIssue(repo, existingNum, entries, runUrl);
    api.write(`Recommendation log updated (${entries.length} entries).\n`);
  }

  if (recommendations.length === 0) {
    api.setOutput('escalated_count', '0', outputPath);
    api.write('No actionable recommendations — APR-E10 log updated.\n');
    return { status: 'no-recommendations', escalated: 0, entries };
  }

  // Count consecutive occurrences of each fingerprint.
  // "Consecutive" = appears in the last N entries where N ≥ 2, in a row.
  const fpCounts = {};
  const fpTexts = {};
  for (const rec of recommendations) {
    const fp = rec.fingerprint;
    fpTexts[fp] = rec.text;
    fpCounts[fp] = countConsecutive(entries, fp);
  }

  // Escalate fingerprints that hit the threshold (≥2 consecutive runs)
  let escalated = 0;
  for (const [fp, count] of Object.entries(fpCounts)) {
    if (count < 2) continue;

    // Check if already escalated
    const existingEscalation = api.findEscalationIssue(repo, fp, 'open');
    if (existingEscalation != null) {
      api.write(
        `Fingerprint ${fp} already has escalation issue #${existingEscalation} — skipping.\n`,
      );
      continue;
    }

    // Best-effort check for merged fix PR
    const historicalEscalation = api.findEscalationIssue(repo, fp, 'all');
    if (api.hasMergedFixPr(repo, fp, historicalEscalation)) {
      api.write(
        `Fingerprint ${fp} has a merged fix PR — skipping escalation.\n`,
      );
      continue;
    }

    // Narrow the search/create race when two audit runs finish together.
    const racedEscalation = api.findEscalationIssue(repo, fp, 'open');
    if (racedEscalation != null) {
      api.write(
        `Fingerprint ${fp} was concurrently escalated as #${racedEscalation} — skipping.\n`,
      );
      continue;
    }

    api.createEscalationIssue(repo, fp, fpTexts[fp], count, runUrl);
    api.write(
      `Escalated fingerprint ${fp} (appeared in ${count} consecutive runs).\n`,
    );
    escalated++;
  }

  api.setOutput('escalated_count', String(escalated), outputPath);
  api.write(`APR-E10 complete: ${escalated} new escalation(s).\n`);
  return { status: 'complete', escalated, entries };
}

function main({ argv = process.argv, apiOverrides = {} } = {}) {
  const repo = getArg('--repo', argv);
  if (!repo) {
    process.stderr.write('Error: --repo is required\n');
    process.exit(1);
  }

  return runAudit(
    {
      repo,
      runUrl: getArg('--run-url', argv) || '',
      rawOutput: getArg('--structured-output', argv) || '',
      outputPath: getArg('--github-output', argv) || '',
    },
    apiOverrides,
  );
}

module.exports = {
  LOG_TITLE,
  LOG_SEARCH_MARKER,
  fingerprint,
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
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  }
}
