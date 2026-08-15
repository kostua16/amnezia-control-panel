/* eslint-disable @typescript-eslint/no-require-imports */
// CLI driver that turns `gh pr list --json` output into consolidation groups.
// Reads PR JSON, applies deterministic selection + kind-strict grouping, then
// classifies every group as selected / unsafe / filtered / capped-deferred
// with an explicit decision record. Pure grouping lives in merge-pr-logic.cjs;
// classification + report payload live here and are unit-tested.
const fs = require('node:fs');
const { selectStalePrs, groupStalePrs } = require('./merge-pr-logic.cjs');

const DECISION_CODES = {
  CONSOLIDATE_SELECTED: 'CONSOLIDATE_SELECTED',
  CONSOLIDATE_CAPPED: 'CONSOLIDATE_CAPPED',
  REBASE_FIRST_CONFLICT: 'REBASE_FIRST_CONFLICT',
  MANUAL_REVIEW_MULTI_CONFLICT: 'MANUAL_REVIEW_MULTI_CONFLICT',
  MANUAL_REVIEW_DEPENDENCY: 'MANUAL_REVIEW_DEPENDENCY',
  REPORT_ONLY_EMPTY: 'REPORT_ONLY_EMPTY',
  FILTERED_OUT: 'FILTERED_OUT',
};

const CAPPED_REASON = 'Consolidate-eligible but deferred by max_groups cap';
const FILTERED_REASON = 'Group excluded by exact group_filter match';
const DRY_RUN_CLOSURE = 'dry-run; write path deferred';
const WRITE_DEFERRED_CLOSURE = 'write path deferred; closure not attempted';

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function isTrue(value) {
  return value === true || value === 'true';
}

function readInput(inPath) {
  const raw =
    !inPath || inPath === '-'
      ? fs.readFileSync(0, 'utf8')
      : fs.readFileSync(inPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.prs ?? parsed.data ?? []);
}

function appendOutputs(values) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) return;
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  fs.appendFileSync(githubOutput, `${lines.join('\n')}\n`);
}

function decisionFor(group, disposition) {
  if (disposition === 'filtered') {
    return {
      decision_code: DECISION_CODES.FILTERED_OUT,
      reason: FILTERED_REASON,
      consolidation_eligible: false,
    };
  }
  if (disposition === 'capped-deferred') {
    return {
      decision_code: DECISION_CODES.CONSOLIDATE_CAPPED,
      reason: CAPPED_REASON,
      consolidation_eligible: true,
    };
  }
  const action = group.recommended_action;
  if (action === 'rebase-first') {
    return {
      decision_code: DECISION_CODES.REBASE_FIRST_CONFLICT,
      reason:
        group.rejection_reason ||
        'Single conflicting PR should be rebased in place before consolidation',
      consolidation_eligible: false,
    };
  }
  if (action === 'manual-review' && group.kind === 'dependency') {
    return {
      decision_code: DECISION_CODES.MANUAL_REVIEW_DEPENDENCY,
      reason:
        group.rejection_reason ||
        'Dependency groups require manual review and are not auto-consolidated',
      consolidation_eligible: false,
    };
  }
  if (action === 'manual-review') {
    return {
      decision_code: DECISION_CODES.MANUAL_REVIEW_MULTI_CONFLICT,
      reason:
        group.rejection_reason ||
        'Mutually conflicting PRs require manual review; auto-consolidation is unsafe',
      consolidation_eligible: false,
    };
  }
  if (action === 'report-only') {
    return {
      decision_code: DECISION_CODES.REPORT_ONLY_EMPTY,
      reason: group.rejection_reason || 'Empty group cannot be consolidated',
      consolidation_eligible: false,
    };
  }
  return {
    decision_code: DECISION_CODES.CONSOLIDATE_SELECTED,
    reason: 'Kind-strict compatible group is eligible for consolidation',
    consolidation_eligible: true,
  };
}

function enrichGroup(group, { disposition }) {
  const described = decisionFor(group, disposition);
  const eligible = described.consolidation_eligible;
  return {
    ...group,
    group_id: group.id,
    action: group.recommended_action,
    disposition,
    decision_code: described.decision_code,
    reason: described.reason,
    consolidation_eligible: eligible,
    closure_policy: eligible ? 'deferred-write-path' : 'not-eligible',
    closure_status: 'not-attempted',
    rejection_reason:
      disposition === 'selected' && eligible
        ? null
        : (group.rejection_reason ?? described.reason),
  };
}

function closureResultsFor(groups, dryRun) {
  const seen = new Set();
  const results = [];
  for (const group of groups) {
    for (const num of group.source_prs || []) {
      if (seen.has(num)) continue;
      seen.add(num);
      results.push({
        pr: num,
        closed: false,
        status: 'not-attempted',
        reason: dryRun ? DRY_RUN_CLOSURE : WRITE_DEFERRED_CLOSURE,
      });
    }
  }
  return results;
}

function classifyGroups(groups, { groupFilter, maxGroups }) {
  const selected = [];
  const unsafe = [];
  const filtered = [];
  const capped = [];
  for (const group of groups) {
    if (groupFilter && group.id !== groupFilter) {
      filtered.push(enrichGroup(group, { disposition: 'filtered' }));
      continue;
    }
    if (group.recommended_action !== 'consolidate') {
      unsafe.push(enrichGroup(group, { disposition: 'unsafe' }));
      continue;
    }
    if (selected.length >= maxGroups) {
      capped.push(enrichGroup(group, { disposition: 'capped-deferred' }));
      continue;
    }
    selected.push(enrichGroup(group, { disposition: 'selected' }));
  }
  return { selected, unsafe, filtered, capped };
}

function finalizeStalePrSelection({
  groups = [],
  groupFilter = '',
  maxGroups = 1,
  minAgeHours = 23,
  dryRun = true,
  stalePrCount = 0,
} = {}) {
  const classified = classifyGroups(groups, { groupFilter, maxGroups });
  const { selected, unsafe, filtered, capped } = classified;
  const skipped = [...unsafe, ...filtered, ...capped];
  const all = groups.map((group) => {
    const match = [...selected, ...skipped].find((g) => g.id === group.id);
    return match ?? enrichGroup(group, { disposition: 'unsafe' });
  });
  return {
    all,
    selected,
    skipped,
    unsafe,
    filtered,
    capped_deferred: capped,
    closure_results: closureResultsFor(all, dryRun),
    validation: {
      dryRun,
      minAgeHours,
      maxGroups,
      groupFilter: groupFilter || '',
      stalePrCount,
      groupCount: groups.length,
      selectedCount: selected.length,
      unsafeCount: unsafe.length,
      filteredCount: filtered.length,
      cappedDeferredCount: capped.length,
    },
  };
}

function main() {
  const inPath = getArg('--in', '-');
  const outDir = getArg('--out-dir', '.');
  const minAgeHours = ((n) => (Number.isFinite(n) && n >= 0 ? n : 23))(
    Number(getArg('--min-age-hours', '23')),
  );
  const maxGroups = ((n) => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1))(
    Number(getArg('--max-groups', '1')),
  );
  const groupFilter = getArg('--group-filter', '');
  const now = getArg('--now');
  const dryRun = isTrue(getArg('--dry-run', 'true'));

  const options = { minAgeHours };
  if (now) options.now = new Date(now);

  const prs = readInput(inPath);
  const stale = selectStalePrs(prs, options);
  const groups = groupStalePrs(stale);
  const result = finalizeStalePrSelection({
    groups,
    groupFilter,
    maxGroups,
    minAgeHours,
    dryRun,
    stalePrCount: stale.length,
  });

  fs.writeFileSync(
    path_join(outDir, 'merge-pr-groups.json'),
    JSON.stringify(result, null, 2),
  );

  const sourcePrs = result.selected.flatMap((g) => g.source_prs);
  const sourceShas = Object.fromEntries(
    sourcePrs.map((num) => {
      const pr = stale.find((p) => p.number === num);
      return [String(num), pr?.headRefOid ?? ''];
    }),
  );
  const first = result.selected[0];
  appendOutputs({
    total_groups: String(groups.length),
    safe_group_count: String(
      result.selected.length + result.capped_deferred.length,
    ),
    has_safe_group: String(result.selected.length > 0),
    selected_count: String(result.selected.length),
    selected_json: JSON.stringify(result.selected),
    skipped_json: JSON.stringify(result.skipped),
    source_prs_csv: sourcePrs.join(','),
    source_prs_json: JSON.stringify(sourcePrs),
    source_pr_shas_json: JSON.stringify(sourceShas),
    first_group_id: first ? first.id : '',
    first_group_title: first ? first.title : '',
  });

  console.log(
    `merge-pr selection: ${stale.length} stale PRs → ${groups.length} groups ` +
      `(${result.selected.length} selected, ${result.unsafe.length} unsafe, ` +
      `${result.filtered.length} filtered, ${result.capped_deferred.length} capped).`,
  );
}

function path_join(...parts) {
  return require('node:path').join(...parts);
}

if (require.main === module) {
  main();
}

module.exports = {
  DECISION_CODES,
  readInput,
  enrichGroup,
  finalizeStalePrSelection,
  closureResultsFor,
};
