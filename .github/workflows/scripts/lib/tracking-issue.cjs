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
  const title = String(issue.title || '')
    .trim()
    .toLowerCase();
  if (TRACKING_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix))) {
    return true;
  }

  const labels = normalizeLabels(issue.labels);
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
