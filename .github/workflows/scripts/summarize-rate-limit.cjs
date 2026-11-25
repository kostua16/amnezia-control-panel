/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const readline = require('node:readline');

// Summarises RATE_LIMIT and REST_COUNT lines read from stdin.
//
//   for id in $(gh run list --limit 50 --json databaseId --jq '.[].databaseId'); do
//     gh run view "$id" --log
//   done | node .github/workflows/scripts/summarize-rate-limit.cjs
//
// Output: one row per quota window (core_reset), with how far `remaining` fell
// inside it (a lower bound of what the window consumed, at least max - min: every concurrent job shares the
// bucket, so per-job deltas are NOT attributable and are deliberately not printed), plus
// every job whose start and end readings came from different windows or different tokens.
// Readings without a usable `core_reset` are counted but never pooled into a window.

const FIELD = /(\w+)=("[^"]*"|\S+)/g;
const NO_WINDOW = 'n/a';

function parseLine(line) {
  const at = line.indexOf('RATE_LIMIT ');
  if (at === -1) return null;
  const fields = {};
  for (const [, key, raw] of line.slice(at).matchAll(FIELD)) {
    fields[key] = raw.replace(/^"|"$/g, '');
  }
  const remaining = Number(String(fields.core_remaining ?? '').split('/')[0]);
  const limit = Number(String(fields.core_remaining ?? '').split('/')[1]);
  if (!Number.isFinite(remaining) || !Number.isFinite(limit)) return null;
  // `n/a` or a missing field means the reading carries no window identity.
  const reset = Number.isNaN(Date.parse(fields.core_reset ?? ''))
    ? NO_WINDOW
    : fields.core_reset;
  return { ...fields, core_reset: reset, remaining, limit };
}

function parseRestCount(line) {
  const match = line.match(
    /(?:^|\s)REST_COUNT workflow=("(?:[^"\\]|\\.)*") job=(\S+) run=(\d+\.\d+) (.+)$/,
  );
  if (!match) return null;
  const [, name, job, run, body] = match;
  try {
    const workflow = JSON.parse(name);
    if (/^status=unavailable reason=[a-z-]+\s*$/.test(body)) {
      return { workflow, job, run, status: 'unavailable' };
    }
    const counts = body.match(
      /^(?:status=(uninstrumented) )?total=(\d+) graphql=(\d+)(?: instrumented=(\d+) unreadable=(\d+))?(?: via=(\{\S+?\}) graphql_via=(\{\S+?\}))?( gh=unavailable)? by_route=(\{.*\})\s*$/,
    );
    if (!counts) return null;
    const [
      ,
      status,
      rawTotal,
      rawGraphql,
      rawInstrumented = '0',
      rawUnreadable = '0',
      rawVia,
      rawGraphqlVia,
      ghUnavailable,
      rawRoutes,
    ] = counts;
    const total = Number(rawTotal);
    const graphql = Number(rawGraphql);
    const instrumented = Number(rawInstrumented);
    const unreadable = Number(rawUnreadable);
    const routes = Object.entries(JSON.parse(rawRoutes));
    const via = parseSources(rawVia, total);
    const graphqlVia = parseSources(rawGraphqlVia, graphql);
    if (
      !via ||
      !graphqlVia ||
      ![total, graphql, instrumented, unreadable].every(Number.isSafeInteger) ||
      routes.some(([, count]) => !Number.isSafeInteger(count) || count <= 0) ||
      routes.reduce((sum, [, count]) => sum + count, 0) !== total
    )
      return null;
    return {
      workflow,
      job,
      run,
      status,
      total,
      graphql,
      instrumented,
      unreadable,
      via,
      graphqlVia,
      ghUnavailable: Boolean(ghUnavailable),
      routes,
    };
  } catch {
    return null;
  }
}

function parseSources(raw, total) {
  if (raw === undefined) return { node: total, gh: 0 };
  const { node, gh } = JSON.parse(raw);
  if (
    Number.isSafeInteger(node) &&
    Number.isSafeInteger(gh) &&
    node >= 0 &&
    gh >= 0 &&
    node + gh === total
  )
    return { node, gh };
  return null;
}

function summarizeRestCounts(lines) {
  const groups = new Map();
  for (const line of lines) {
    const count = parseRestCount(line);
    if (!count) continue;
    const { workflow, job, run } = count;
    const key = JSON.stringify([workflow, job]);
    const group = groups.get(key) ?? {
      workflow,
      job,
      runs: new Set(),
      reports: 0,
      unavailableRuns: new Set(),
      unreadableFiles: 0,
      ghUnavailableReports: 0,
      total: 0,
      graphql: 0,
      via: { node: 0, gh: 0 },
      graphqlVia: { node: 0, gh: 0 },
      routes: new Map(),
    };
    // Matrix jobs share run and job IDs. Each report is a separate execution.
    group.runs.add(run);
    group.reports += 1;
    if (count.ghUnavailable) group.ghUnavailableReports += 1;
    if (count.status) {
      group.unavailableRuns.add(run.split('.', 1)[0]);
    } else {
      group.unreadableFiles += count.unreadable;
      group.total += count.total;
      group.graphql += count.graphql;
      for (const source of ['node', 'gh']) {
        group.via[source] += count.via[source];
        group.graphqlVia[source] += count.graphqlVia[source];
      }
      for (const [route, requests] of count.routes) {
        group.routes.set(route, (group.routes.get(route) ?? 0) + requests);
      }
    }
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.workflow.localeCompare(b.workflow) || a.job.localeCompare(b.job),
  );
}

function summarize(lines) {
  const entries = lines.map(parseLine).filter(Boolean);
  const windows = new Map();
  const jobs = new Map();
  let withoutWindow = 0;
  for (const entry of entries) {
    if (entry.core_reset === NO_WINDOW) {
      // Pooling these with real windows would hide the real spread and invent
      // a window called `n/a`.
      withoutWindow += 1;
    } else {
      // A bucket is identified by its reset time and the kind of token that
      // owns it (installation tokens, PATs and so on never share a bucket, and
      // two kinds could coincide on one reset second). Every job has its own
      // token, but jobs of one installation draw from one bucket, so grouping
      // by token would split it into per-job rows: tokens are only counted here
      // and compared per job in the mismatch check below.
      const bucketKey = `${entry.core_reset}|${entry.token ?? 'unknown'}`;
      const window = windows.get(bucketKey) ?? {
        reset: entry.core_reset,
        kind: entry.token ?? 'unknown',
        limit: entry.limit,
        min: Infinity,
        max: -Infinity,
        readings: 0,
        tokens: new Set(),
        tagged: 0,
      };
      window.min = Math.min(window.min, entry.remaining);
      window.max = Math.max(window.max, entry.remaining);
      window.readings += 1;
      if (entry.token_id) {
        window.tokens.add(entry.token_id);
        window.tagged += 1;
      }
      windows.set(bucketKey, window);
    }

    // The label is part of the key: one job can log several independent
    // start/end pairs (e.g. setup-environment plus job-level calls). Repeated
    // invocations with the same label are paired like nested calls: post steps run in
    // reverse order, so a job-end closes the most recent open job-start.
    const jobKey = `${entry.run}|${entry.job}|${entry.label ?? ''}`;
    const pairs = jobs.get(jobKey) ?? [];
    jobs.set(jobKey, pairs);
    const base = {
      workflow: entry.workflow ?? '-',
      job: entry.job ?? '-',
      label: entry.label ?? '-',
      run: entry.run ?? '-',
    };
    if (entry.phase === 'job-start') {
      pairs.push({ ...base, 'job-start': entry });
    } else if (entry.phase === 'job-end') {
      const open = pairs.findLast((pair) => !pair['job-end']);
      if (open) open['job-end'] = entry;
      else pairs.push({ ...base, 'job-end': entry });
    }
  }

  // A label whose job-start and job-end counts differ (an invocation lost its
  // end reading) cannot be paired reliably, so it is counted as ambiguous and
  // never compared: a guess could invent a phantom window mismatch.
  const skipped = [];
  const allPairs = [...jobs.values()]
    .filter((pairs) => {
      const starts = pairs.filter((pair) => pair['job-start']).length;
      const ends = pairs.filter((pair) => pair['job-end']).length;
      if (starts === ends) return true;
      const { workflow, job, label, run } = pairs[0];
      skipped.push(
        `${workflow} / ${job} (label ${label}, run ${run}): ${starts} starts, ${ends} ends`,
      );
      return false;
    })
    .flat();
  const mismatched = allPairs.filter((job) => {
    const start = job['job-start'];
    const end = job['job-end'];
    return (
      start &&
      end &&
      (start.core_reset !== end.core_reset ||
        (start.token_id ?? '') !== (end.token_id ?? ''))
    );
  });

  return {
    restCounts: summarizeRestCounts(lines),
    readings: entries.length,
    withoutWindow,
    ambiguous: skipped.length,
    skipped,
    windows: [...windows.values()].sort((a, b) =>
      a.reset.localeCompare(b.reset),
    ),
    jobsWithBoth: allPairs.filter((job) => job['job-start'] && job['job-end'])
      .length,
    mismatched,
  };
}

function format(summary) {
  const out = [
    `RATE_LIMIT readings: ${summary.readings}` +
      (summary.withoutWindow
        ? ` (${summary.withoutWindow} without a quota window, left out of the windows)`
        : ''),
  ];
  for (const w of summary.windows) {
    out.push(
      `window reset=${w.reset} kind=${w.kind}: remaining ${w.max} -> ${w.min} of ${w.limit} ` +
        `(>= ${w.max - w.min} used between the highest and lowest reading, ${w.readings} readings, ${w.tagged} with token_id from ${w.tokens.size} distinct tokens)`,
    );
  }
  out.push(
    `jobs with start+end: ${summary.jobsWithBoth}, ` +
      `start and end from a different window/token: ${summary.mismatched.length}` +
      (summary.ambiguous
        ? `, skipped label groups (unequal start/end counts): ${summary.ambiguous}`
        : ''),
  );
  for (const description of summary.skipped)
    out.push(`  skipped ${description}`);
  for (const job of summary.mismatched) {
    const start = job['job-start'];
    const end = job['job-end'];
    out.push(
      `  ${job.workflow} / ${job.job}: start reset=${start.core_reset} token_id=${start.token_id ?? '-'}` +
        ` -> end reset=${end.core_reset} token_id=${end.token_id ?? '-'}`,
    );
  }
  for (const group of summary.restCounts ?? []) {
    const via = group.via ?? { node: group.total, gh: 0 };
    const graphqlVia = group.graphqlVia ?? { node: group.graphql, gh: 0 };
    out.push(
      `REST_COUNT workflow=${JSON.stringify(group.workflow)} job=${group.job} ` +
        `runs=${group.runs.size} reports=${group.reports} total=${group.total} ` +
        `graphql=${group.graphql} by_route=${JSON.stringify(Object.fromEntries([...group.routes].sort()))} ` +
        `unavailable_jobs=${group.unavailableRuns?.size ?? 0} unreadable_files=${group.unreadableFiles ?? 0} ` +
        `via=${JSON.stringify(via)} graphql_via=${JSON.stringify(graphqlVia)} ` +
        `gh_unavailable_reports=${group.ghUnavailableReports ?? 0}`,
    );
  }
  return out.join('\n');
}

if (require.main === module) {
  // Keep only the telemetry lines to bound memory on large log collections.
  const lines = [];
  const reader = readline.createInterface({ input: process.stdin });
  reader.on('line', (line) => {
    if (line.includes('RATE_LIMIT ') || line.includes('REST_COUNT '))
      lines.push(line);
  });
  reader.on('close', () => console.log(format(summarize(lines))));
}

module.exports = { format, parseLine, parseRestCount, summarize };
