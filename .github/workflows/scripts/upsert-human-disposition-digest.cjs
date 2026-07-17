#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

'use strict';

const { escapeTableCell, escapeBulletItem } = require('./md-escape.cjs');

const DIGEST_TITLE = 'Auto PR Audit: human-disposition digest';
const DIGEST_LABELS = ['auto-fix', 'needs-review'];
const ISSUE_SEARCH_MARKER = 'auto-pr-audit human disposition in:title';

// Backward-compatible aliases for tests and downstream consumers.
const escapeCell = escapeTableCell;
const escapeListItem = escapeBulletItem;

function parseArgs(argv) {
  const args = {};
  let i = 2;
  while (i < argv.length) {
    const flag = argv[i];
    if (flag === '--repo' || flag === '--structured-output' || flag === '--run-url') {
      args[flag.slice(2)] = argv[i + 1] || '';
      i += 2;
    } else {
      i++;
    }
  }
  return args;
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

function renderDigestBody(data, runUrl, repoUrl) {
  const disposition = Array.isArray(data.human_disposition)
    ? data.human_disposition
    : [];
  const inspected = Array.isArray(data.auto_prs_inspected)
    ? data.auto_prs_inspected
    : [];

  if (disposition.length === 0 && inspected.length === 0) {
    return [
      '## Auto PR Audit — Human Disposition Digest',
      '',
      `> Last updated: ${new Date().toISOString().split('T')[0]} — [audit run](${runUrl})`,
      '',
      '_No PRs currently require human disposition._',
    ].join('\n');
  }

  if (!repoUrl) repoUrl = '';

  const lines = [
    '## Auto PR Audit — Human Disposition Digest',
    '',
    `> Last updated: ${new Date().toISOString().split('T')[0]} — [audit run](${runUrl})`,
    '',
  ];

  if (disposition.length > 0) {
    lines.push('### Recommended Actions');
    lines.push('');
    for (const item of disposition) {
      lines.push(`- ${escapeListItem(item)}`);
    }
    lines.push('');
  }

  if (inspected.length > 0) {
    lines.push('### Inspected PRs');
    lines.push('');
    lines.push('| # | Title | Author | Branch | Recommendation |');
    lines.push('|---|-------|--------|--------|----------------|');
    for (const pr of inspected) {
      const prUrl = pr.number != null && repoUrl ? `${repoUrl}/pull/${pr.number}` : '';
      const num = pr.number != null && prUrl ? `[#${pr.number}](${prUrl})` : (pr.number != null ? `#${pr.number}` : '-');
      const title = escapeCell(pr.title || '-');
      const author = escapeCell(pr.author || '-');
      const branch = escapeCell(pr.branch || '-');
      const rec = escapeCell(pr.recommendation || '-');
      lines.push(`| ${num} | ${title} | ${author} | ${branch} | ${rec} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function runGh(args, input) {
  const { execFileSync } = require('child_process');
  const stdio = ['pipe', 'pipe', 'pipe'];
  const result = execFileSync('gh', args, { input: input || '', stdio, encoding: 'utf8' });
  return result.trim();
}

function findExistingIssue(repo) {
  try {
    const out = runGh(
      ['issue', 'list', '--repo', repo, '--state', 'open', '--search', ISSUE_SEARCH_MARKER, '--json', 'number', '--jq', '.[0].number // empty'],
    );
    const num = parseInt(out, 10);
    return Number.isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

function createIssue(repo, title, body, labels) {
  runGh([
    'issue', 'create', '--repo', repo, '--title', title, '--body', body,
    '--label', labels.join(','),
  ]);
}

function refreshIssue(repo, issueNum, body) {
  runGh(['issue', 'edit', String(issueNum), '--repo', repo, '--body-file', '-'], body);
}

async function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo;
  const runUrl = args['run-url'] || '';
  const rawOutput = args['structured-output'] || '';

  if (!repo) {
    process.stderr.write('Error: --repo is required\n');
    process.exit(1);
  }

  const repoUrl = `https://github.com/${repo}`;

  const data = parseStructuredOutput(rawOutput);
  if (!data) {
    process.stderr.write('No structured output to digest — skipping.\n');
    process.exit(0);
  }

  const disposition = Array.isArray(data.human_disposition) ? data.human_disposition : [];
  const inspected = Array.isArray(data.auto_prs_inspected) ? data.auto_prs_inspected : [];

  if (disposition.length === 0 && inspected.length === 0) {
    // Nothing to publish — optionally clear the digest issue
    const existing = findExistingIssue(repo);
    if (existing != null) {
      const body = renderDigestBody({ human_disposition: [], auto_prs_inspected: [] }, runUrl, repoUrl);
      refreshIssue(repo, existing, body);
      process.stdout.write(`Cleared digest issue #${existing} (no dispositions).\n`);
    } else {
      process.stdout.write('No dispositions to publish and no existing digest issue.\n');
    }
    process.exit(0);
  }

  const body = renderDigestBody(data, runUrl, repoUrl);
  const existing = findExistingIssue(repo);

  if (existing != null) {
    refreshIssue(repo, existing, body);
    process.stdout.write(`Refreshed digest issue #${existing} with ${disposition.length} disposition(s).\n`);
  } else {
    createIssue(repo, DIGEST_TITLE, body, DIGEST_LABELS);
    process.stdout.write(`Created new digest issue with ${disposition.length} disposition(s).\n`);
  }
}

module.exports = {
  escapeCell,
  escapeListItem,
  parseArgs,
  parseStructuredOutput,
  renderDigestBody,
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  });
}
