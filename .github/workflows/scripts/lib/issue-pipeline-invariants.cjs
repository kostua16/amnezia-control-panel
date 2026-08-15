'use strict';

// Issue-pipeline invariant findings for the hourly catch-up sweep: detection,
// remediation metadata, and the rolling claude-health report format.
//
// Two invariants exist:
// - inert_bot_command: a `/fix` or `/triage` comment authored by
//   github-actions[bot]. GITHUB_TOKEN events never start workflows, so
//   whatever posted it believed it triggered something that never ran (the
//   failure that stranded issue #771). Actionable output needs the source
//   comment URL, the actor that posted it, which trigger path produced it,
//   and a deterministic remediation.
// - stuck_fixable: a triaged, automation-fixable, prioritized issue with no
//   linked PR and no active fix run after 24h. Actionable output needs the
//   last real fix attempt, what is holding the issue, its owner, and the next
//   step — not just an age counter. Fix-attempt count and timestamp derive
//   from the same caller-filtered comment list (the sweep resets the budget
//   at a dead-letter retry), so they can never contradict each other.
//
// The hash in the report covers the normalized actionable state only:
// timestamps, age_hours, ordering, comment URLs, and owners change hourly
// without changing what a human must do, so they are excluded. A meaningful
// change (a new finding, a different attempt count, a different next action)
// changes the hash and re-posts; hourly age ticks do not.
//
// This module is pure: no network, no clock reads inside detection (callers
// pass `now`), no filesystem. The workflow embedded scripts and the tests
// are the only callers.

const crypto = require('node:crypto');
const { isTrackingIssue, normalizeLabels } = require('./tracking-issue.cjs');

const BOT_LOGIN = 'github-actions[bot]';
const COMMAND_PATTERN = /^\s*\/(fix|triage)\b/;
// Dispatch markers prove a real workflow_dispatch happened: the re-triage
// step posts `<!-- re-triage-dispatch -->` after the API call succeeds, and
// the dead-letter retry posts `<!-- dead-letter-retry -->` immediately before
// its `/fix`. A bot command adjacent to such a marker was posted by a real
// dispatch path, not left inert by a GITHUB_TOKEN event.
const DISPATCH_MARKERS = ['<!-- re-triage-dispatch -->', '<!-- dead-letter-retry -->'];
// Labels that legitimately hold an issue out of the fix pipeline. They do not
// silence a finding — a stuck issue parked for weeks is still stuck — but they
// change the next action from "route a fix" to "maintainer unblocks".
const BLOCKING_LABELS = ['security', 'critical', 'needs-review', 'triage-failed'];
// A finding line lists at most this many source comments; the count stays
// exact.
const MAX_SOURCES_PER_LINE = 3;

function commentUrl(comment = {}, issueNumber) {
  if (comment.html_url) return comment.html_url;
  if (issueNumber && comment.id) {
    // Fall back only when the API object shape is available; callers that
    // cannot build a URL (unit fixtures without ids) show the timestamp.
    return `issues/${issueNumber}#comment:${comment.id}`;
  }
  return null;
}

function isBotCommandComment(comment) {
  return (
    comment.user?.login === BOT_LOGIN && COMMAND_PATTERN.test(comment.body || '')
  );
}

// Which automation path posted an inert command comment. Anything else is a
// legacy/stale comment. Leading whitespace is stripped so an indented bot
// command classifies by what it says, not how it was formatted (COMMAND_PATTERN
// already tolerates indentation; the trigger path must not disagree with it).
function commandTriggerPath(comment) {
  const body = (comment.body || '').trim();
  if (body.startsWith('/triage')) return 'legacy-catchup-retriage';
  if (body.startsWith('/fix')) return 'catchup-phase6-autofix';
  return 'unknown';
}

// A command comment next to a dispatch marker came from a real dispatch path
// (the marker is only posted after the workflow_dispatch API call succeeded),
// so it is not inert. Adjacency is positional in the chronological comment
// list: the re-triage marker lands right after its trigger, and the
// dead-letter retry posts its marker immediately before the `/fix`.
function isMarkerAdjacent(comments, index) {
  for (const neighbor of [comments[index - 1], comments[index + 1]]) {
    if (neighbor && DISPATCH_MARKERS.some((m) => (neighbor.body || '').includes(m))) {
      return true;
    }
  }
  return false;
}

// Deterministic remediation: the same trigger path always prescribes the same
// action. GH_PAT dispatch is the repo's proven real-trigger mechanism
// (GITHUB_TOKEN comment events never start workflows).
function inertCommandAction(triggerPath) {
  if (triggerPath === 'legacy-catchup-retriage') {
    return 'dispatch triage.yml via workflow_dispatch (GH_PAT) or delete the inert comment';
  }
  if (triggerPath === 'catchup-phase6-autofix') {
    return 'dispatch fix-issue.yml via workflow_dispatch (GH_PAT) or delete the inert comment';
  }
  return 'delete the inert comment (unknown trigger path)';
}

function detectInertBotCommand({ issueNumber, comments = [] }) {
  const commands = comments
    .map((comment, index) => ({ comment, index }))
    .filter(({ comment }) => isBotCommandComment(comment))
    .filter(({ index }) => !isMarkerAdjacent(comments, index));
  if (commands.length === 0) return null;
  const last = commands[commands.length - 1].comment;
  const actor = last.user?.login || BOT_LOGIN;
  const triggerPath = commandTriggerPath(last);
  return {
    type: 'inert_bot_command',
    number: issueNumber,
    count: commands.length,
    last_at: last.created_at || null,
    sources: commands.slice(-MAX_SOURCES_PER_LINE).map(({ comment: c }) => ({
      url: commentUrl(c, issueNumber),
      actor: c.user?.login || BOT_LOGIN,
      created_at: c.created_at || null,
    })),
    actor,
    trigger_path: triggerPath,
    action: inertCommandAction(triggerPath),
  };
}

function linkedPrState({ issue, comments = [] }) {
  const text = `${issue.body || ''} ${comments.map((c) => c.body || '').join(' ')}`;
  if (/Fixes #\d+/.test(text)) return 'closing-keyword';
  if (/pull\/\d+/.test(text)) return 'pr-link';
  if (/PR:.*#\d+/.test(text)) return 'pr-reference';
  return 'none';
}

// The caller passes the fix-attempt comments it counts as budget (already
// filtered past the dead-letter-retry reset), so the count and the timestamp
// come from one list and cannot disagree.
function lastFixAttemptAt(fixComments = []) {
  if (fixComments.length === 0) return null;
  const sorted = [...fixComments].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
  );
  return sorted[sorted.length - 1].created_at || null;
}

// The auto-fix label is a hard prerequisite of this detector, and the repo
// treats it as the automation-authorship marker — so a stuck finding is always
// automation-owned. Maintainer involvement surfaces through blocking_labels
// (the "maintainer unblocks" next action), never through owner.
function autoFixOwner() {
  return 'automation';
}

// Deterministic next action for a stuck issue. A held issue never gets an
// automated fix routed; the dead-letter route only applies once attempts
// burned the budget.
function stuckNextAction({ fixAttempts, blockingLabels }) {
  if (blockingLabels.length > 0) {
    return `maintainer unblocks (${blockingLabels.join(', ')}), then route the fix`;
  }
  if (fixAttempts >= 2) {
    return 'route to fix dead-letter (park with needs-review + manual review)';
  }
  return 'dispatch fix-issue.yml via workflow_dispatch (GH_PAT)';
}

function detectStuckFixable({
  issue,
  comments = [],
  fixComments = [],
  activeFixRun = false,
  now = Date.now(),
}) {
  if (!issue) return null;

  // False-positive exclusions, cheapest first. These mirror the sweep's own
  // routing guards: tracking issues, exempt labels, closed state, linked PRs,
  // and active runs are all either owned by other workflows or already on a
  // path to resolution. Age and label shape determine whether the invariant
  // applies at all.
  if (issue.state === 'closed') return null;
  const labels = normalizeLabels(issue.labels);
  if (isTrackingIssue({ ...issue, labels })) return null;
  const EXEMPT = ['keep-open', 'backlog', 'in-progress', 'fixed'];
  if (EXEMPT.some((l) => labels.includes(l))) return null;

  const prState = linkedPrState({ issue, comments });
  if (prState !== 'none') return null;
  if (activeFixRun) return null;

  const createdAt = new Date(issue.created_at || 0).getTime();
  const ageHours = Math.max(0, Math.round((now - createdAt) / 3600000));
  if (!(createdAt < now - 24 * 60 * 60 * 1000)) return null;

  const isTriaged = labels.includes('triaged');
  const isAutoFix = labels.includes('auto-fix');
  const hasPriority = ['low', 'medium', 'high'].some((p) => labels.includes(p));
  if (!isTriaged || !isAutoFix || !hasPriority) return null;

  const blockingLabels = BLOCKING_LABELS.filter((l) => labels.includes(l));
  const owner = autoFixOwner();
  return {
    type: 'stuck_fixable',
    number: issue.number,
    title: String(issue.title || ''),
    age_hours: ageHours,
    fix_attempts: fixComments.length,
    last_fix_attempt_at: lastFixAttemptAt(fixComments),
    blocking_labels: blockingLabels,
    linked_pr_state: prState,
    owner,
    next_action: stuckNextAction({ fixAttempts: fixComments.length, blockingLabels }),
  };
}

// Normalized actionable state per finding type. Everything a human would not
// act on differently — timestamps, age, urls, owner display, order — is
// dropped. blocking_labels and action/next_action stay: they change what the
// remediation IS, so they must re-post.
function normalizeForHash(finding) {
  if (finding.type === 'inert_bot_command') {
    return [finding.type, finding.number, finding.count, finding.trigger_path, finding.action];
  }
  if (finding.type === 'stuck_fixable') {
    return [
      finding.type,
      finding.number,
      finding.fix_attempts,
      [...finding.blocking_labels].sort(),
      finding.next_action,
    ];
  }
  return [String(finding.type), finding.number];
}

function findingsHash(findings = []) {
  const normalized = findings
    .map(normalizeForHash)
    .map((row) => JSON.stringify(row))
    .sort();
  return crypto.createHash('sha256').update(normalized.join('\n')).digest('hex').slice(0, 16);
}

const MAX_REPORTED = 50;

function renderInertLine(f) {
  const sources = (f.sources || [])
    .filter((s) => s.url)
    .slice(0, MAX_SOURCES_PER_LINE)
    .map((s) => `[${s.created_at || '?'}](${s.url})`)
    .join(', ');
  const src = sources ? `; sources: ${sources}` : '';
  return (
    `- #${f.number} — **inert bot command**: ${f.count} \`/fix\`/\`/triage\` comment(s) by \`${f.actor}\` ` +
    `(\`${f.trigger_path}\`)${src} — **action**: ${f.action}`
  );
}

function renderStuckLine(f) {
  const holds = f.blocking_labels.length > 0 ? `, held by ${f.blocking_labels.join('+')}` : '';
  const last =
    f.last_fix_attempt_at ? `, last attempt ${f.last_fix_attempt_at}` : ', no real attempt yet';
  return (
    `- #${f.number} — **stuck fixable issue**: triaged + auto-fix + priority, no linked PR after ` +
    `${f.age_hours}h (${f.fix_attempts} fix attempt(s)${last})${holds} — owner: ${f.owner} — ` +
    `**next**: ${f.next_action}`
  );
}

function renderFindingsReport({ findings = [], generatedAt = '' }) {
  if (findings.length === 0) return null;
  const reported = findings.slice(0, MAX_REPORTED);
  const lines = reported.map((f) =>
    f.type === 'inert_bot_command' ? renderInertLine(f) : renderStuckLine(f),
  );
  if (findings.length > MAX_REPORTED) {
    lines.push(`- …and ${findings.length - MAX_REPORTED} more finding(s) — see the run summary`);
  }
  const hash = findingsHash(findings);
  const marker = `<!-- invariant-findings:${hash} -->`;
  const body = [
    marker,
    `## Invariant findings (${generatedAt})`,
    '',
    ...lines,
    '',
    '_Reported by issue-catch-up. Each line carries its remediation; an unchanged actionable state is not re-posted._',
  ].join('\n');
  return { hash, marker, body };
}

// The latest tracker comment's marker matches → actionable state unchanged →
// skip. Volatile-only drift produces the same hash by construction.
function isUnchangedReport({ latestBody = '', marker }) {
  if (!marker) return false;
  return latestBody.includes(marker);
}

module.exports = {
  BLOCKING_LABELS,
  MAX_REPORTED,
  detectInertBotCommand,
  detectStuckFixable,
  findingsHash,
  isUnchangedReport,
  renderFindingsReport,
};
