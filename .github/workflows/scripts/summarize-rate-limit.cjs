'use strict';

// Summarises RATE_LIMIT lines (see .github/actions/log-rate-limit) read from stdin.
//
//   for id in $(gh run list --limit 50 --json databaseId --jq '.[].databaseId'); do
//     gh run view "$id" --log
//   done | node .github/workflows/scripts/summarize-rate-limit.cjs
//
// Output: one row per quota window (core_reset), with how far `remaining` fell inside it
// (an upper bound of what the window consumed: every concurrent job shares the bucket, so
// per-job deltas are NOT attributable and are deliberately not printed), plus every job
// whose start and end readings came from different windows or different tokens.

const FIELD = /(\w+)=("[^"]*"|\S+)/g;

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
  return { ...fields, remaining, limit };
}

function summarize(lines) {
  const entries = lines.map(parseLine).filter(Boolean);
  const windows = new Map();
  const jobs = new Map();
  for (const entry of entries) {
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

    const jobKey = `${entry.run}|${entry.job}`;
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
  const out = [`RATE_LIMIT readings: ${summary.readings}`];
  for (const w of summary.windows) {
    out.push(
      `window reset=${w.reset} token=${w.token}: remaining ${w.max} -> ${w.min} of ${w.limit} ` +
        `(>= ${w.max - w.min} used between the first and last reading, ${w.readings} readings)`,
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
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    console.log(format(summarize(input.split(/\r?\n/))));
  });
}

module.exports = { format, parseLine, summarize };
