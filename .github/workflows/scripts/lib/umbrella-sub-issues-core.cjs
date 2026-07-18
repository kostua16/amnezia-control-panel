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

// Sub-issues are born fully classified: the backlog table already fixes the
// priority, and spin-off is automation-authored. Applying `triaged` at
// creation keeps the fix pipeline independent of the AI triage workflow
// (a triage outage must not strand pre-classified sub-issues).
function subIssueLabels(item, subIssueLabel) {
  return ['auto-fix', subIssueLabel, priorityLabel(item.priority), 'triaged'];
}

// Deterministic stand-in for the AI triage summary. Must contain the literal
// "Triage Result" marker (issue-catch-up keys its triaged_no_fix bucket and
// triage timestamps on it) and must NOT contain the substrings "/triage",
// "/fix", "Fixes #", "pull/", or "PR:" — catch-up counts those as
// triage/fix attempts or linked-PR evidence.
function buildTriageResultComment({ item, umbrellaNumber }) {
  return [
    '## Triage Result',
    '- **Classification:** backlog item (pre-classified)',
    `- **Priority:** ${priorityLabel(item.priority)}`,
    `- **Labels applied:** auto-fix, umbrella-sub-issue, ${priorityLabel(item.priority)}, triaged`,
    '- **Duplicates found:** none (spin-off dedupes by TODO id)',
    `- **Notes:** Deterministic triage — spun off from the docs/TODOs-2.md backlog via umbrella #${umbrellaNumber}; classification and priority come from the ${item.id} table row, so AI triage is skipped.`,
  ].join('\n');
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
  // Count distinct TODO ids that have ANY open sub-issue, independent of input
  // ordering. byId keeps only the first issue per id, so a closed duplicate
  // appearing before the open sub-issue would otherwise under-count open slots
  // and briefly let the cap be exceeded by one.
  const openIds = new Set();
  for (const issue of existingSubIssues) {
    const todoId = subIssueTodoId(issue);
    if (todoId && isOpenState(issue)) openIds.add(todoId);
  }
  const openCount = openIds.size;
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

// Self-heal duplicate sub-issues left by a concurrent spin-off: the hourly
// --all sweep and an on-demand /fix can both observe the same open-slot
// snapshot and each create a sub-issue for the same TODO id. For each TODO
// id with more than one OPEN sub-issue, keep one and flag the rest to close.
// Keeper preference: a natively-linked sub-issue (issue.nativeLinked === true,
// tagged by the CLI wrapper from the GitHub sub_issues list) wins so the
// umbrella's native progress bar stays accurate; ties break to the
// lowest-numbered (first created). Inputs may list the same issue twice
// (native sub-issue list + label search overlap), so dedup by number first.
// A closed-as-not_planned duplicate must NOT tick the umbrella checkbox, so
// callers close with reason `not_planned` (not `completed`).
function duplicateSubIssuesToClose(subIssues) {
  const byNumber = new Map();
  for (const issue of subIssues ?? []) {
    if (issue == null || issue.number == null) continue;
    if (!byNumber.has(issue.number)) byNumber.set(issue.number, issue);
  }
  const openById = new Map();
  for (const issue of byNumber.values()) {
    if (!isOpenState(issue)) continue;
    const todoId = subIssueTodoId(issue);
    if (!todoId) continue;
    if (!openById.has(todoId)) openById.set(todoId, []);
    openById.get(todoId).push(issue);
  }
  const toClose = [];
  for (const group of openById.values()) {
    if (group.length <= 1) continue;
    const sorted = group.slice().sort((a, b) => {
      // Prefer a natively-linked keeper so the GitHub-native umbrella progress
      // bar keeps tracking the surviving child; otherwise lowest issue number.
      if (!!a.nativeLinked !== !!b.nativeLinked) {
        return a.nativeLinked ? -1 : 1;
      }
      return a.number - b.number;
    });
    const keep = sorted[0];
    for (const issue of sorted.slice(1)) {
      toClose.push({
        number: issue.number,
        todoId: subIssueTodoId(issue),
        keepNumber: keep.number,
      });
    }
  }
  return toClose;
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
  buildTriageResultComment,
  duplicateSubIssuesToClose,
  extractDocExcerpt,
  extractWorkflowName,
  isCompletedState,
  isOpenState,
  parseChecklist,
  planSpinOff,
  priorityLabel,
  subIssueLabels,
  subIssueMarker,
  subIssueTodoId,
};
