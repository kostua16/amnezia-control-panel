#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Promotes ONE deferred GSD proposal back into the executable planning queue.
 *
 * Deferred proposals are `gsd-deferred-proposal` issues created by
 * upsert-audit-manual-findings.cjs; without promotion they are a dead end —
 * nothing reads them back. This script selects the OLDEST eligible issue and
 * writes its body as a `.planning/quick/deferred-issue-<n>-plan.md` artifact,
 * which collect-gsd-planning-intake.cjs imports into the Phase-999 queue once
 * the promotion PR merges through the normal review-gated planning-PR path.
 *
 * The `in-progress` label on the source issue is the promotion marker: it
 * keeps the issue out of future selections (and out of issue-catch-up's
 * buckets) while the promotion PR is in flight.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROMOTION_LABEL = 'gsd-deferred-proposal';
const EXCLUDED_LABELS = [
  'security',
  'critical',
  'keep-open',
  'in-progress',
  'duplicate',
  'canceled',
  'fixed',
];

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
}

function appendOutput(outputPath, key, value) {
  const delimiter = `EOF-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.appendFileSync(
    outputPath,
    `${key}<<${delimiter}\n${String(value ?? '')}\n${delimiter}\n`,
  );
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function normalizeLabels(labels) {
  return (labels ?? []).map((label) =>
    typeof label === 'string' ? label : String(label?.name ?? ''),
  );
}

/**
 * Returns the oldest open deferred-proposal issue eligible for promotion, or
 * null. Pure (no I/O) so it can be unit-tested without mocking `gh`.
 */
function selectPromotableIssue(issues) {
  const eligible = (issues ?? []).filter((issue) => {
    if (!issue || typeof issue !== 'object') return false;
    const labels = normalizeLabels(issue.labels);
    if (!labels.includes(PROMOTION_LABEL)) return false;
    if (EXCLUDED_LABELS.some((label) => labels.includes(label))) return false;
    return String(issue.body ?? '').trim().length > 0;
  });
  eligible.sort((a, b) =>
    String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')),
  );
  return eligible[0] ?? null;
}

/**
 * Builds the planning artifact for a deferred-proposal issue. The filename
 * must satisfy collect-gsd-planning-intake.cjs's isPlanningArtifact filter
 * (`*-plan.md`). Pure (no I/O).
 */
function buildPlanArtifact(issue) {
  const title = String(issue.title ?? '')
    .replace(/^\[gsd-deferred\]\s*/i, '')
    .trim();
  const body = String(issue.body ?? '').trim();
  const content = [
    `# ${title || `Deferred proposal from issue #${issue.number}`}`,
    '',
    `Source: deferred-proposal issue #${issue.number}.`,
    '',
    body,
    '',
  ].join('\n');
  return {
    path: `.planning/quick/deferred-issue-${issue.number}-plan.md`,
    content,
  };
}

function run() {
  const outputPath = getArg('--github-output') || process.env.GITHUB_OUTPUT;
  const emit = (result) => {
    if (outputPath) {
      for (const [key, value] of Object.entries(result)) {
        appendOutput(outputPath, key, value);
      }
      return;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  };

  let issues;
  try {
    issues =
      JSON.parse(
        gh([
          'issue',
          'list',
          '--label',
          PROMOTION_LABEL,
          '--state',
          'open',
          '--limit',
          '50',
          '--json',
          'number,title,body,labels,createdAt',
        ]),
      ) || [];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`::error::gh issue list failed. ${detail}\n`);
    process.exit(1);
  }

  const issue = selectPromotableIssue(issues);
  if (!issue) {
    process.stdout.write('No eligible deferred proposal to promote.\n');
    emit({ promoted: 'false', issue_number: '', artifact_path: '' });
    return;
  }

  const artifact = buildPlanArtifact(issue);
  fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
  fs.writeFileSync(artifact.path, artifact.content);
  process.stdout.write(`Promoted issue #${issue.number} to ${artifact.path}\n`);
  emit({
    promoted: 'true',
    issue_number: String(issue.number),
    artifact_path: artifact.path,
    issue_title: String(issue.title ?? ''),
  });
}

module.exports = { buildPlanArtifact, selectPromotableIssue };

if (require.main === module) {
  run();
}
