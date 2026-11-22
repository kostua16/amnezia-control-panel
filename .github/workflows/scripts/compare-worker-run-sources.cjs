/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only parity check for the two worker-run lookups. For each PR it loads
// the runs of every configured worker through the per-workflow lookup the PR
// flow used before (`gh run list --workflow`) and through the head-sha lookup,
// feeds both into summarizeWorkerRuns and compares what the orchestrator would
// act on. Prints a table and exits 1 when the new lookup lost something.
//
// Per PR and worker the matching runs (PR number + head sha in the title) are
// classified:
//   identical      same runs; active, latest, failedCount and target url must
//                  agree
//   extra-older    the new lookup also sees older runs of this PR and head
//                  that the repo-wide `--limit 50` window evicted; active and
//                  latest must still agree. failedCount can only grow, which
//                  makes a retry cap trigger sooner, never later
//   recovered      the old window held none of this PR's runs, the new lookup
//                  finds some (the old lookup would see "never ran")
//   REGRESSION     the old lookup found a matching run the new one missed, or
//                  the summaries disagree where they must agree
//
// Usage (needs an authenticated `gh`; GITHUB_REPOSITORY defaults to the
// current repo):
//   node compare-worker-run-sources.cjs --pr 1090 --pr 1100
//   node compare-worker-run-sources.cjs --open --merged 30
//
// It only issues GET requests; it never writes to GitHub.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { run } = require('./lib/sticky-comment.cjs');
const { createWorkerRunsLoader } = require('./lib/worker-runs-by-head.cjs');

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

function listPrs(args) {
  const numbers = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--pr') numbers.push(Number(args[++i]));
    else if (args[i] === '--open') {
      const rows = JSON.parse(
        gh([
          'pr',
          'list',
          '--state',
          'open',
          '--limit',
          '200',
          '--json',
          'number',
        ]),
      );
      numbers.push(...rows.map((r) => r.number));
    } else if (args[i] === '--merged') {
      const count = Number(args[++i]);
      const rows = JSON.parse(
        gh([
          'pr',
          'list',
          '--state',
          'merged',
          '--limit',
          '200',
          '--json',
          'number,mergedAt',
        ]),
      );
      rows.sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
      numbers.push(...rows.slice(0, count).map((r) => r.number));
    }
  }
  return [...new Set(numbers.filter(Number.isInteger))];
}

function pick(flow, summary) {
  return {
    active: summary.active?.databaseId ?? null,
    latest: summary.latest?.databaseId ?? null,
    failedCount: summary.failedCount,
    url: flow.getWorkerTargetUrl(summary, ''),
  };
}

function classify(oldRuns, newRuns, flow, pr, workerName) {
  const matching = (runs) =>
    runs.filter((runItem) => flow.matchesWorkerTitle(runItem, pr));
  const oldIds = new Set(matching(oldRuns).map((r) => r.databaseId));
  const newIds = new Set(matching(newRuns).map((r) => r.databaseId));
  const missed = [...oldIds].filter((id) => !newIds.has(id));
  if (missed.length > 0) {
    return {
      kind: 'REGRESSION',
      detail: `new missed runs ${missed.join(',')}`,
    };
  }

  const before = pick(
    flow,
    flow.summarizeWorkerRuns({ [workerName]: oldRuns }, workerName, pr),
  );
  const after = pick(
    flow,
    flow.summarizeWorkerRuns({ [workerName]: newRuns }, workerName, pr),
  );
  const extra = newIds.size - oldIds.size;

  if (extra === 0) {
    const same = JSON.stringify(before) === JSON.stringify(after);
    return same
      ? { kind: 'identical' }
      : {
          kind: 'REGRESSION',
          detail: `summary differs ${JSON.stringify(before)} vs ${JSON.stringify(after)}`,
        };
  }
  if (oldIds.size === 0) {
    return { kind: 'recovered', detail: `+${extra} runs` };
  }
  const sameWhereItMatters =
    before.active === after.active &&
    before.latest === after.latest &&
    before.url === after.url;
  return sameWhereItMatters
    ? {
        kind: 'extra-older',
        detail: `+${extra} older, failedCount ${before.failedCount}->${after.failedCount}`,
      }
    : {
        kind: 'REGRESSION',
        detail: `active/latest differ ${JSON.stringify(before)} vs ${JSON.stringify(after)}`,
      };
}

function main() {
  process.env.GITHUB_REPOSITORY ||= gh([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]);
  // Required only after GITHUB_REPOSITORY is set: the loaders read it lazily.
  const flow = require('./orchestrate-pr-flow.cjs');
  const config = JSON.parse(fs.readFileSync('.github/pr-flow.json', 'utf8'));
  const workers = Object.keys(config.workers ?? {}).filter(
    (name) => config.workers[name]?.workflow,
  );
  const numbers = listPrs(process.argv.slice(2));
  if (numbers.length === 0) {
    console.error('Pass --pr <n>, --open or --merged <count>.');
    process.exit(2);
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const rows = [];
  const readErrors = [];
  for (const number of numbers) {
    try {
      const meta = JSON.parse(
        gh([
          'pr',
          'view',
          String(number),
          '--json',
          'headRefOid,state,isCrossRepository',
        ]),
      );
      const pr = {
        number,
        headSha: meta.headRefOid,
        isCrossRepository: meta.isCrossRepository,
        // The orchestrator resolves this before the lookup; the dispatch window
        // is only trusted when it reaches back to the head commit. Strict: a
        // failed read would otherwise read as "date unknown", send every worker
        // of this PR down the per-workflow path and compare it with itself.
        headCommittedAt: flow.fetchHeadCommittedAt(meta.headRefOid, {
          strict: true,
        }),
      };
      const row = {
        number,
        state: meta.state,
        sha: pr.headSha.slice(0, 7),
        cross: pr.isCrossRepository,
        results: [],
        restNew: 0,
        fellBack: null,
      };

      // The reference: what the orchestrator read before, one lookup per worker.
      // Strict, so a rate-limited or 5xx read aborts the comparison instead of
      // reading as an empty window the new lookup "recovered" from.
      const oldRuns = Object.fromEntries(
        workers.map((name) => [
          name,
          flow.collectWorkerRuns(config, name, { strict: true }),
        ]),
      );
      // gh run list resolves the workflow, then lists its runs.
      row.restOld = workers.length * 2;

      const warnings = [];
      let legacyUsed = false;
      const loadNew = createWorkerRunsLoader({
        config,
        pr,
        source: 'head',
        getRepo: () => repo,
        run: (...args) => {
          row.restNew += 1;
          return run(...args);
        },
        loadLegacy: (name) => {
          legacyUsed = true;
          row.restNew += 2;
          return flow.collectWorkerRuns(config, name, { strict: true });
        },
        warn: (message) => warnings.push(message),
      });
      const newRuns = Object.fromEntries(
        workers.map((name) => [name, loadNew(name)]),
      );
      row.fellBack = legacyUsed
        ? pr.isCrossRepository
          ? 'cross-repo'
          : warnings[0] || 'fallback'
        : null;

      for (const name of workers) {
        row.results.push({
          name,
          ...classify(oldRuns[name], newRuns[name], flow, pr, name),
        });
      }
      rows.push(row);
      console.error(`compared #${number} (${rows.length}/${numbers.length})`);
    } catch (error) {
      // A failed strict read says nothing about the lookups; keep going and
      // report it separately so it is never mistaken for a regression.
      readErrors.push({
        number,
        message: String(error.message ?? error).split('\n')[0],
      });
      console.error(`could not read #${number}: ${readErrors.at(-1).message}`);
    }
  }

  console.log('| PR | state | head | lookup | REST old -> new | per worker |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) {
    const cells = r.results
      .map((x) => `${x.name}: ${x.kind}${x.detail ? ` (${x.detail})` : ''}`)
      .join('; ');
    console.log(
      `| #${r.number} | ${r.state} | ${r.sha} | ${r.fellBack ? `fallback (${r.fellBack})` : 'head'} | ${r.restOld} -> ${r.restNew} | ${cells} |`,
    );
  }

  const counts = {};
  for (const r of rows) {
    for (const x of r.results) counts[x.kind] = (counts[x.kind] ?? 0) + 1;
  }
  const headRows = rows.filter((r) => !r.fellBack);
  const prsWithExtra = rows.filter((r) =>
    r.results.some((x) => x.kind === 'extra-older'),
  ).length;
  const prsRecovered = rows.filter((r) =>
    r.results.some((x) => x.kind === 'recovered'),
  ).length;
  const regressions = rows.filter((r) =>
    r.results.some((x) => x.kind === 'REGRESSION'),
  );
  console.log(
    `\nPRs: ${rows.length} (${headRows.length} via head lookup, ${rows.length - headRows.length} fallback)`,
  );
  console.log(`worker comparisons: ${JSON.stringify(counts)}`);
  console.log(
    `PRs where the new lookup sees extra older runs: ${prsWithExtra}; PRs where it recovers runs the old window lost: ${prsRecovered}`,
  );
  console.log(
    `REST reads per wake (all workers): old ${rows[0]?.restOld ?? 'n/a'}, new ${headRows[0]?.restNew ?? 'n/a'} on the head path`,
  );
  console.log(`regressions: ${regressions.length}`);
  console.log(`read errors: ${readErrors.length}`);
  for (const failed of readErrors) {
    console.log(`  #${failed.number}: ${failed.message}`);
  }
  // 1 = the new lookup lost runs; 3 = some PRs could not be read at all, so the
  // result is incomplete (never reported as success).
  if (regressions.length > 0) process.exit(1);
  process.exit(readErrors.length > 0 ? 3 : 0);
}

if (require.main === module) main();

module.exports = { classify };
