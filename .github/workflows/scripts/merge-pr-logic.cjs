// Deterministic selection and compatibility grouping for stale PR
// consolidation. Pure functions only — no network. The merge-pr workflow feeds
// `gh pr list --json` output in and reads consolidation groups out.
//
// Grouping is intentionally kind-strict: a PR's dominant changed-path kind
// decides its consolidation lane, so workflow, dependency, database, planning,
// and runtime changes are never consolidated together. Cross-kind consolidation
// is a later refinement; this conservative v1 favors safety over coverage and
// keeps the grouping unit-testable from fixture JSON.

const DEFAULT_MIN_AGE_HOURS = 23;
const DEFAULT_MAX_GROUP_SIZE = 3;

// Labels that disqualify a source PR from consolidation selection. `keep-open`
// is an operator-owned escape hatch honored here even though this workflow does
// not apply it.
const EXCLUDE_LABELS = ['do-not-merge', 'keep-open', 'fresh/superseded'];

// Highest priority first. A PR touching both .github/** and src/** is treated as
// workflow so its app-code changes do not leak into a runtime consolidation.
const KIND_PRIORITY = [
  'workflow',
  'dependency',
  'database',
  'planning',
  'app-code',
];

const KIND_TITLES = {
  workflow: 'Workflow automation',
  dependency: 'Dependency updates',
  database: 'Database schema and migrations',
  planning: 'Planning artifacts',
  'app-code': 'Runtime application code',
};

function classifyPathKind(filePath) {
  const p = String(filePath ?? '');
  if (p.startsWith('.github/')) return 'workflow';
  if (p === 'package.json' || p === 'package-lock.json') return 'dependency';
  if (p.startsWith('prisma/')) return 'database';
  if (p.startsWith('.planning/')) return 'planning';
  return 'app-code';
}

function pathsOf(pr) {
  return Array.isArray(pr?.files)
    ? pr.files.map((f) => (f && f.path) || '').filter(Boolean)
    : [];
}

function dominantKindForPr(pr) {
  const paths = pathsOf(pr);
  if (paths.length === 0) return 'app-code';
  const present = new Set(paths.map(classifyPathKind));
  for (const kind of KIND_PRIORITY) {
    if (present.has(kind)) return kind;
  }
  return 'app-code';
}

function labelNames(pr) {
  return Array.isArray(pr?.labels)
    ? pr.labels.map((l) => l && l.name).filter(Boolean)
    : [];
}

// Age in hours from createdAt. A PR with no parseable createdAt is treated as
// infinitely old (selected) so a metadata gap never silently hides a stale PR.
function ageHours(pr, now = new Date()) {
  const created = pr?.createdAt ? Date.parse(pr.createdAt) : NaN;
  if (!Number.isFinite(created)) return Infinity;
  return (Date.parse(now) - created) / 3_600_000;
}

function selectStalePrs(prs, options = {}) {
  const minAgeHours = options.minAgeHours ?? DEFAULT_MIN_AGE_HOURS;
  const exclude = new Set(options.excludeLabels ?? EXCLUDE_LABELS);
  return (Array.isArray(prs) ? prs : []).filter((pr) => {
    if (!pr) return false;
    if ((pr.state ?? 'OPEN') !== 'OPEN') return false;
    if (pr.isDraft) return false;
    if (pr.isCrossRepository) return false;
    if (ageHours(pr, options.now) <= minAgeHours) return false;
    if (!pr.headRefName) return false;
    if (pathsOf(pr).length === 0) return false;
    if (labelNames(pr).some((name) => exclude.has(name))) return false;
    return true;
  });
}

function conflictRiskFor(mergeStates) {
  const states = (Array.isArray(mergeStates) ? mergeStates : []).map((s) =>
    String(s ?? ''),
  );
  if (states.includes('CONFLICTING')) return 'high';
  if (states.includes('UNKNOWN')) return 'medium';
  return 'low';
}

function recommendActionForGroup(group) {
  if (!group || group.source_prs.length === 0) return 'report-only';
  // A high-conflict-risk group is never auto-consolidated: a single conflicting
  // PR should be rebased in place, and a multi-PR group of mutually-conflicting
  // PRs (the riskiest consolidation) must be reviewed manually. Only low/medium
  // risk groups are eligible for "consolidate".
  if (group.conflict_risk === 'high') {
    return group.source_prs.length === 1 ? 'rebase-first' : 'manual-review';
  }
  if (group.kind === 'dependency') return 'manual-review';
  return 'consolidate';
}

function buildGroup(kind, prs) {
  const numbers = prs.map((p) => p.number);
  const changedPaths = Array.from(new Set(prs.flatMap(pathsOf)));
  const group = {
    id: `${kind}-${numbers.join('-')}`,
    title: KIND_TITLES[kind] ?? 'Mixed changes',
    kind,
    source_prs: numbers,
    changed_paths: changedPaths,
    review_thread_count: prs.reduce(
      (sum, p) => sum + (p.review_thread_count ?? 0),
      0,
    ),
    conflict_risk: conflictRiskFor(prs.map((p) => p.mergeable)),
    max_group_size: prs.length,
    recommended_action: 'consolidate',
    rejection_reason: null,
  };
  group.recommended_action = recommendActionForGroup(group);
  group.rejection_reason = rejectionReasonFor(group);
  return group;
}

// Stable human reason for a non-consolidate action. null when the group is
// eligible to consolidate so reports never invent a rejection for a selected
// group. Kept in the grouping layer so selection can copy it verbatim.
function rejectionReasonFor(group) {
  if (!group || group.recommended_action === 'consolidate') return null;
  if (group.recommended_action === 'rebase-first') {
    return 'Single conflicting PR should be rebased in place before consolidation';
  }
  if (
    group.recommended_action === 'manual-review' &&
    group.kind === 'dependency'
  ) {
    return 'Dependency groups require manual review and are not auto-consolidated';
  }
  if (group.recommended_action === 'manual-review') {
    return 'Mutually conflicting PRs require manual review; auto-consolidation is unsafe';
  }
  return 'Empty group cannot be consolidated';
}

// Partition selected PRs by dominant kind, split conflicting from clean within
// each kind, then cap each partition at maxGroupSize. Different kinds are never
// mixed (conservative v1). Returns groups in deterministic kind-then-number order.
function groupStalePrs(selected, options = {}) {
  const maxGroupSize = options.maxGroupSize ?? DEFAULT_MAX_GROUP_SIZE;
  const size = maxGroupSize > 0 ? maxGroupSize : DEFAULT_MAX_GROUP_SIZE;
  const sorted = (Array.isArray(selected) ? selected : [])
    .slice()
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  const buckets = new Map();
  for (const pr of sorted) {
    const kind = dominantKindForPr(pr);
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind).push(pr);
  }

  const groups = [];
  for (const kind of KIND_PRIORITY) {
    const prs = buckets.get(kind);
    if (!prs || prs.length === 0) continue;
    const conflicting = prs.filter((p) => p.mergeable === 'CONFLICTING');
    const clean = prs.filter((p) => p.mergeable !== 'CONFLICTING');
    for (const partition of [clean, conflicting]) {
      for (let i = 0; i < partition.length; i += size) {
        groups.push(buildGroup(kind, partition.slice(i, i + size)));
      }
    }
  }
  return groups;
}

module.exports = {
  DEFAULT_MIN_AGE_HOURS,
  DEFAULT_MAX_GROUP_SIZE,
  EXCLUDE_LABELS,
  KIND_PRIORITY,
  classifyPathKind,
  dominantKindForPr,
  selectStalePrs,
  conflictRiskFor,
  recommendActionForGroup,
  rejectionReasonFor,
  groupStalePrs,
};
