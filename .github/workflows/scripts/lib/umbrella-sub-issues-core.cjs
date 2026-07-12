'use strict';

// Pure logic for spinning off umbrella checklist items into dedicated
// sub-issues and reconciling them back (tick checkbox on completion, close
// the umbrella when every item is ticked). No network/gh calls here — the
// CLI wrapper (../umbrella-sub-issues.cjs) owns those, so tests stay pure.

const CHECKLIST_ITEM_RE = /^- \[( |x)\] ([A-Z]{2,4}-[IE]\d{2}) \(P(\d)\) (.+)$/;
const SUB_ISSUE_TITLE_ID_RE = /^([A-Z]{2,4}-[IE]\d{2}):/;
const DEFAULT_OPEN_CAP = 3;

function subIssueMarker(todoId) {
  return `<!-- umbrella-sub-issue: ${todoId} -->`;
}

function parseChecklist(body) {
  const items = [];
  const lines = String(body || '').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(CHECKLIST_ITEM_RE);
    if (!match) continue;
    items.push({
      checked: match[1] === 'x',
      id: match[2],
      priority: Number(match[3]),
      title: match[4].trim(),
      line: lines[index],
      lineIndex: index,
    });
  }
  return items;
}

function extractWorkflowName(umbrellaTitle) {
  const match = String(umbrellaTitle || '').match(
    /^\s*\[todo-backlog\]\s*([^:]+):/i,
  );
  return match ? match[1].trim() : '';
}

// P0/P1 → high, P2 → medium, P3+ → low (matches triage's priority ladder and
// keeps sub-issues auto-fix eligible, which requires low/medium/high).
function priorityLabel(priority) {
  if (priority <= 1) return 'high';
  if (priority === 2) return 'medium';
  return 'low';
}

function buildSubIssueTitle(item, workflowName) {
  // Drop trailing cross-reference suffixes ("— XC-1") from the title; the
  // verbatim checklist line is preserved in the body.
  const title = item.title.replace(/\s+—\s+XC-\d+\s*$/, '');
  const suffix = workflowName ? ` (${workflowName})` : '';
  return `${item.id}: ${title}${suffix}`;
}

function buildSubIssueBody({ item, umbrellaNumber, docExcerpt }) {
  const sections = [
    subIssueMarker(item.id),
    '',
    `Part of #${umbrellaNumber} (umbrella tracking issue — stays open; this sub-issue tracks exactly one backlog item).`,
    '',
    '### Backlog item',
    '',
    '```',
    item.line,
    '```',
  ];
  if (docExcerpt) {
    sections.push('', '### Rationale (from docs/TODOs-2.md)', '', docExcerpt);
  }
  sections.push(
    '',
    `See \`docs/TODOs-2.md\` for the full rationale, evidence, effort, and risk for ${item.id}.`,
    '',
    '### Process',
    '',
    `- Reference **${item.id}** in the fix commits and PR.`,
    `- The fix PR should close THIS issue (not #${umbrellaNumber}); the umbrella checkbox is ticked automatically once this issue closes as completed.`,
  );
  return sections.join('\n');
}

// Extract the markdown table row for a TODO id from docs/TODOs-2.md content.
function extractDocExcerpt(docContent, todoId) {
  const row = String(docContent || '')
    .split('\n')
    .find((line) => line.startsWith(`| ${todoId} `));
  return row ? row.trim() : '';
}

function subIssueTodoId(issue) {
  const fromTitle = String(issue.title || '').match(SUB_ISSUE_TITLE_ID_RE);
  if (fromTitle) return fromTitle[1];
  const fromBody = String(issue.body || '').match(
    /<!-- umbrella-sub-issue: ([A-Z]{2,4}-[IE]\d{2}) -->/,
  );
  return fromBody ? fromBody[1] : '';
}

function isOpenState(issue) {
  return String(issue.state || '').toLowerCase() === 'open';
}

function isCompletedState(issue) {
  return (
    String(issue.state || '').toLowerCase() === 'closed' &&
    String(issue.stateReason ?? issue.state_reason ?? '').toLowerCase() ===
      'completed'
  );
}

// Decide which checklist items to spin off now. `existingSubIssues` covers
// every known sub-issue of this umbrella in ANY state (a closed sub-issue
// must never be re-created).
function planSpinOff({
  items,
  existingSubIssues = [],
  cap = DEFAULT_OPEN_CAP,
}) {
  const byId = new Map();
  for (const issue of existingSubIssues) {
    const todoId = subIssueTodoId(issue);
    if (todoId && !byId.has(todoId)) byId.set(todoId, issue);
  }
  const openCount = [...byId.values()].filter(isOpenState).length;
  const slots = Math.max(0, cap - openCount);

  const candidates = items
    .filter((item) => !item.checked && !byId.has(item.id))
    .sort((a, b) => a.priority - b.priority || a.lineIndex - b.lineIndex);

  return {
    toCreate: candidates.slice(0, slots),
    deferred: candidates.slice(slots),
    openCount,
    slots,
  };
}

// Tick checkboxes for completed sub-issues. Returns the new body and which
// TODO ids were ticked (only unchecked items change).
function applyTicks(body, completedIds) {
  const wanted = new Set(completedIds);
  const ticked = [];
  const lines = String(body || '')
    .split('\n')
    .map((line) => {
      const match = line.match(CHECKLIST_ITEM_RE);
      if (!match || match[1] === 'x' || !wanted.has(match[2])) return line;
      ticked.push(match[2]);
      return line.replace('- [ ]', '- [x]');
    });
  return { body: lines.join('\n'), ticked };
}

function allItemsChecked(body) {
  const items = parseChecklist(body);
  return items.length > 0 && items.every((item) => item.checked);
}

module.exports = {
  DEFAULT_OPEN_CAP,
  allItemsChecked,
  applyTicks,
  buildSubIssueBody,
  buildSubIssueTitle,
  extractDocExcerpt,
  extractWorkflowName,
  isCompletedState,
  isOpenState,
  parseChecklist,
  planSpinOff,
  priorityLabel,
  subIssueMarker,
  subIssueTodoId,
};
