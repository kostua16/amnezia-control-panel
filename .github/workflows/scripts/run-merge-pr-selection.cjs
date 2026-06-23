/* eslint-disable @typescript-eslint/no-require-imports */
// CLI driver that turns `gh pr list --json` output into consolidation groups.
// Reads PR JSON, applies deterministic selection + kind-strict grouping, then
// splits groups into "safe" (recommended_action === consolidate) and "skipped"
// (rebase-first / manual-review / report-only), honors --max-groups and an
// optional --group-filter, and emits GitHub step outputs the rest of merge-pr
// consumes. Pure logic lives in merge-pr-logic.cjs; this is IO glue (untested).
const fs = require('node:fs');
const { selectStalePrs, groupStalePrs } = require('./merge-pr-logic.cjs');

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
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
  // All values are single-line (compact JSON / scalars), so the simple
  // key=value form is valid for $GITHUB_OUTPUT.
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  fs.appendFileSync(githubOutput, `${lines.join('\n')}\n`);
}

function main() {
  const inPath = getArg('--in', '-');
  const outDir = getArg('--out-dir', '.');
  const minAgeHours = Number(getArg('--min-age-hours', '23'));
  const maxGroups = Math.max(1, Number(getArg('--max-groups', '1')));
  const groupFilter = getArg('--group-filter', '');
  const now = getArg('--now');

  const options = { minAgeHours };
  if (now) options.now = new Date(now);

  const prs = readInput(inPath);
  const selected = selectStalePrs(prs, options);
  let groups = groupStalePrs(selected);
  // Exact match only: group ids embed source PR numbers, so a substring filter
  // (e.g. "1") would silently over-select every group whose id contains that
  // text. The input is documented as a single group id.
  if (groupFilter) {
    groups = groups.filter((g) => g.id === groupFilter);
  }

  const safe = groups.filter((g) => g.recommended_action === 'consolidate');
  const skipped = groups
    .filter((g) => g.recommended_action !== 'consolidate')
    .map((g) => ({
      id: g.id,
      kind: g.kind,
      source_prs: g.source_prs,
      reason: g.recommended_action,
    }));
  const chosen = safe.slice(0, maxGroups);

  fs.writeFileSync(
    path_join(outDir, 'merge-pr-groups.json'),
    JSON.stringify({ all: groups, selected: chosen, skipped }, null, 2),
  );

  const sourcePrs = chosen.flatMap((g) => g.source_prs);
  // Capture each selected source PR's head sha at collection time so the close
  // step can detect a source updated mid-run (merge-pr-close-guard condition).
  const sourceShas = Object.fromEntries(
    sourcePrs.map((num) => {
      const pr = selected.find((p) => p.number === num);
      return [String(num), pr?.headRefOid ?? ''];
    }),
  );
  const first = chosen[0];
  appendOutputs({
    total_groups: String(groups.length),
    safe_group_count: String(safe.length),
    has_safe_group: String(chosen.length > 0),
    selected_count: String(chosen.length),
    selected_json: JSON.stringify(chosen),
    skipped_json: JSON.stringify(skipped),
    source_prs_csv: sourcePrs.join(','),
    source_prs_json: JSON.stringify(sourcePrs),
    source_pr_shas_json: JSON.stringify(sourceShas),
    first_group_id: first ? first.id : '',
    first_group_title: first ? first.title : '',
  });

  console.log(
    `merge-pr selection: ${selected.length} stale PRs → ${groups.length} groups ` +
      `(${safe.length} safe, ${chosen.length} selected, ${skipped.length} skipped).`,
  );
}

// Local path.join to avoid a top-level require that some linters flag; node's
// path module is stable and this keeps the driver dependency-free at parse time.
function path_join(...parts) {
  return require('node:path').join(...parts);
}

if (require.main === module) {
  main();
}

module.exports = { readInput };
