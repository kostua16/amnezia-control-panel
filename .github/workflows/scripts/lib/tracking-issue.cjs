'use strict';

// Umbrella/tracking issues (todo-backlog umbrellas, rolling claude-health
// trackers, grouped canonical issues) are process artifacts that outlive any
// single fix PR. Automation must never auto-close them, mark them with
// terminal labels (`canceled`), or link fix PRs to them with closing
// keywords — a partial fix would otherwise close a 20-item backlog.

const TRACKING_TITLE_PREFIXES = [
  '[todo-backlog]',
  '[claude-health]',
  '[grouped]',
];

const TRACKING_LABELS = new Set([
  'backlog',
  'epic',
  'umbrella',
  'tracking',
  'keep-open',
  'claude-health',
]);

const TRACKING_BODY_PATTERNS = [
  /umbrella tracking issue/i,
  /\brolling issue\b/i,
];

// A spun-off umbrella sub-issue carries this label. It is, by definition, NOT
// a tracking issue — even though its body references the umbrella with the
// phrase "umbrella tracking issue". Without this exclusion, the body pattern
// below misclassifies every sub-issue as a tracker, so the catch-up sweep and
// the project-manager queue skip it and it never reaches /fix.
const SUB_ISSUE_LABEL = 'umbrella-sub-issue';

function normalizeLabels(labels) {
  if (!labels) return [];
  const list = Array.isArray(labels)
    ? labels
    : String(labels)
        .split(/[\n,]/)
        .map((item) => item.trim());
  return list
    .map((label) =>
      typeof label === 'string' ? label : String(label?.name || ''),
    )
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
}

function isTrackingIssue(issue = {}) {
  const labels = normalizeLabels(issue.labels);

  // Short-circuit: an explicit umbrella-sub-issue label marks a spun-off
  // sub-issue, which must never be treated as a tracker. Check this before the
  // title/label/body rules so the body fallback cannot override it.
  if (labels.includes(SUB_ISSUE_LABEL)) return false;

  const title = String(issue.title || '')
    .trim()
    .toLowerCase();
  if (TRACKING_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix))) {
    return true;
  }

  if (labels.some((label) => TRACKING_LABELS.has(label))) return true;

  const body = String(issue.body || '');
  return TRACKING_BODY_PATTERNS.some((pattern) => pattern.test(body));
}

module.exports = {
  TRACKING_BODY_PATTERNS,
  TRACKING_LABELS,
  TRACKING_TITLE_PREFIXES,
  isTrackingIssue,
  normalizeLabels,
};
