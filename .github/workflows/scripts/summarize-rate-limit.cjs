/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const readline = require('node:readline');

// Summarises RATE_LIMIT lines (see .github/actions/log-rate-limit) read from stdin.
//
//   for id in $(gh run list --limit 50 --json databaseId --jq '.[].databaseId'); do
//     gh run view "$id" --log
//   done | node .github/workflows/scripts/summarize-rate-limit.cjs
//
// Output: one row per quota window (core_reset + token), with how far `remaining` fell
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
      const key = `${entry.core_reset}|${entry.token_id ?? entry.token}`;
      const window = windows.get(key) ?? {
        reset: entry.core_reset,
        token: entry.token_id ?? entry.token,
        limit: entry.limit,
        min: Infinity,
        max: -Infinity,
        readings: 0,
      };
      window.min = Math.min(window.min, entry.remaining);
      window.max = Math.max(window.max, entry.remaining);
      window.readings += 1;
      windows.set(key, window);
    }

    // The label is part of the key: one job can log several independent
    // start/end pairs (e.g. setup-environment plus job-level calls).
    const jobKey = `${entry.run}|${entry.job}|${entry.label ?? ''}`;
    const job = jobs.get(jobKey) ?? {
      workflow: entry.workflow,
      job: entry.job,
    };
    job[entry.phase] = entry;
    jobs.set(jobKey, job);
  }

  const mismatched = [...jobs.values()].filter((job) => {
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
    readings: entries.length,
    withoutWindow,
    windows: [...windows.values()].sort((a, b) =>
      a.reset.localeCompare(b.reset),
    ),
    jobsWithBoth: [...jobs.values()].filter(
      (job) => job['job-start'] && job['job-end'],
    ).length,
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
      `window reset=${w.reset} token=${w.token}: remaining ${w.max} -> ${w.min} of ${w.limit} ` +
        `(>= ${w.max - w.min} used between the highest and lowest reading, ${w.readings} readings)`,
    );
  }
  out.push(
    `jobs with start+end: ${summary.jobsWithBoth}, ` +
      `start and end from a different window/token: ${summary.mismatched.length}`,
  );
  for (const job of summary.mismatched) {
    const start = job['job-start'];
    const end = job['job-end'];
    out.push(
      `  ${job.workflow} / ${job.job}: start reset=${start.core_reset} token_id=${start.token_id ?? '-'}` +
        ` -> end reset=${end.core_reset} token_id=${end.token_id ?? '-'}`,
    );
  }
  return out.join('\n');
}

if (require.main === module) {
  // Only RATE_LIMIT lines are kept, so memory stays proportional to the
  // readings and not to the size of the logs piped in.
  const lines = [];
  const reader = readline.createInterface({ input: process.stdin });
  reader.on('line', (line) => {
    if (line.includes('RATE_LIMIT ')) lines.push(line);
  });
  reader.on('close', () => console.log(format(summarize(lines))));
}

module.exports = { format, parseLine, summarize };
