/* eslint-disable @typescript-eslint/no-require-imports */
// Renders and upserts the stale-PR consolidation report. One central tracking
// issue (found by title + sticky marker, created if absent) carries every run's
// selected groups, skipped groups, replacement PRs, source closure results, and
// validation summary, so consolidation state is reviewable in one place instead
// of scattered across source PR comments. Also optionally appends to the job
// summary. renderMergePrReport is pure and unit-tested; main() is thin IO glue.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPORT_MARKER = '<!-- merge-pr-report -->';
const DEFAULT_ISSUE_TITLE = 'Stale PR consolidation report';

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function renderMergePrReport({
  runUrl,
  generatedAt,
  selectedGroups = [],
  skippedGroups = [],
  replacementPrUrls = [],
  closureResults = [],
  validation = {},
}) {
  const at = generatedAt || new Date().toISOString();
  const lines = [
    REPORT_MARKER,
    '# Stale PR consolidation report',
    '',
    `- Generated: ${at}`,
    `- Run: ${runUrl || '_n/a_'}`,
    `- Mode: ${validation?.dryRun === false || validation?.dryRun === 'false' ? 'write' : 'dry-run'}`,
    '',
    '## Selected groups',
  ];
  if (selectedGroups.length === 0) {
    lines.push('_None._');
  } else {
    for (const g of selectedGroups) {
      lines.push(
        `- **${g.id}** — ${g.kind} · ${g.conflict_risk} risk · ${g.recommended_action} · PRs ${g.source_prs.join(', ')}`,
      );
    }
  }

  lines.push('', '## Skipped groups');
  if (skippedGroups.length === 0) {
    lines.push('_None._');
  } else {
    for (const s of skippedGroups) {
      lines.push(
        `- ${s.id ?? s.group_id ?? '(group)'}: ${s.reason ?? '(no reason)'}`,
      );
    }
  }

  lines.push('', '## Replacement PRs');
  if (replacementPrUrls.length === 0) {
    lines.push('_None._');
  } else {
    for (const u of replacementPrUrls) lines.push(`- ${u}`);
  }

  lines.push('', '## Source PR closure results');
  if (closureResults.length === 0) {
    lines.push('_None._');
  } else {
    for (const c of closureResults) {
      const status = c.closed ? 'closed' : 'left open';
      const note = c.reason ? ` — ${c.reason}` : '';
      lines.push(`- #${c.pr}: ${status}${note}`);
    }
  }

  lines.push(
    '',
    '## Validation',
    '```json',
    JSON.stringify(validation ?? {}, null, 2),
    '```',
    '',
  );
  return lines.join('\n');
}

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
  }).trim();
}

function findExistingIssue(repo, title) {
  const issues = JSON.parse(
    runGh([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--search',
      `in:title ${JSON.stringify(title)}`,
      '--json',
      'number,title,body',
      '--limit',
      '20',
    ]) || '[]',
  );
  return (
    issues.find(
      (i) => i.title === title && String(i.body ?? '').includes(REPORT_MARKER),
    ) ?? null
  );
}

function upsertReportIssue({ repo, title, body }) {
  const bodyFile = path.join(
    os.tmpdir(),
    `merge-pr-report-${process.pid}-${Date.now()}.md`,
  );
  fs.writeFileSync(bodyFile, body, 'utf8');
  try {
    const existing = findExistingIssue(repo, title);
    if (existing) {
      runGh([
        'issue',
        'edit',
        String(existing.number),
        '--repo',
        repo,
        '--body-file',
        bodyFile,
      ]);
      return { number: existing.number, created: false };
    }
    const url = runGh([
      'issue',
      'create',
      '--repo',
      repo,
      '--title',
      title,
      '--body-file',
      bodyFile,
      '--label',
      'maintenance',
    ]);
    return { url, created: true };
  } finally {
    fs.rmSync(bodyFile, { force: true });
  }
}

function main() {
  const reportJson =
    getArg('--report-json') || process.env.MERGE_PR_REPORT_JSON;
  const runUrl =
    getArg('--run-url') || process.env.GITHUB_SERVER_URL
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '';
  const repo = getArg('--repo') || process.env.GITHUB_REPOSITORY;
  const title = getArg('--issue-title', DEFAULT_ISSUE_TITLE);
  const toSummary = getArg('--summary') === 'true';

  const data = reportJson
    ? JSON.parse(fs.readFileSync(reportJson, 'utf8'))
    : {};
  const body = renderMergePrReport({ runUrl, ...data });

  if (toSummary && process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + '\n');
  }
  if (repo) {
    const result = upsertReportIssue({ repo, title, body });
    console.log(
      `merge-pr report ${result.created ? 'created' : 'updated'}: ${result.url || `#${result.number}`}`,
    );
  } else {
    process.stdout.write(body);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  REPORT_MARKER,
  DEFAULT_ISSUE_TITLE,
  renderMergePrReport,
};
