/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
} = require('node:fs');
const { join } = require('node:path');
const { METHODS, ROUTES } = require('./rest-preload.cjs');

const ROUTE_KEYS = new Set(
  [...METHODS, 'OTHER'].flatMap((method) =>
    [...ROUTES, '/other'].map((route) => `${method} ${route}`),
  ),
);

function startRestCounter(env = process.env) {
  if (
    env['INPUT_REST-COUNTER'] !== 'true' ||
    env.REST_COUNTER_DIR ||
    !env.RUNNER_TEMP ||
    !env.GITHUB_ENV ||
    !env.GITHUB_OUTPUT ||
    !env.GITHUB_STATE
  )
    return;

  try {
    const dir = realpathSync(
      mkdtempSync(join(env.RUNNER_TEMP, 'rest-counter-')),
    );
    const preload = join(dir, 'rest-preload.cjs');
    // Keep the preload available when later checkout steps replace the workspace.
    copyFileSync(join(__dirname, 'rest-preload.cjs'), preload);
    // NODE_OPTIONS accepts double-quoted paths. Skip unusual paths that cannot
    // be passed safely in both the environment file and Node's options parser.
    if (/["\r\n]/.test(preload)) return;
    const option = `--require "${preload.replaceAll('\\', '\\\\')}"`;
    appendFileSync(env.GITHUB_STATE, `rest_counter_dir=${dir}\n`);
    appendFileSync(env.GITHUB_ENV, `REST_COUNTER_DIR=${dir}\n`);
    appendFileSync(env.GITHUB_OUTPUT, `rest-counter-preload=${option}\n`);
  } catch {
    // A setup failure disables the counter.
  }
}

function collectRestCounts(dir) {
  let total = 0;
  let graphql = 0;
  const routes = new Map();
  for (const file of readdirSync(dir)) {
    if (!/^requests-[a-f0-9-]+\.log$/.test(file)) continue;
    let records;
    try {
      records = readFileSync(join(dir, file), 'utf8').split('\n');
    } catch {
      continue;
    }
    // Ignore an incomplete last write and any unrecognized record.
    records.pop();
    for (const route of records) {
      if (route === 'graphql') {
        graphql += 1;
      } else if (ROUTE_KEYS.has(route)) {
        total += 1;
        routes.set(route, (routes.get(route) ?? 0) + 1);
      }
    }
  }
  return { total, graphql, by_route: Object.fromEntries([...routes].sort()) };
}

function reportRestCounter({ env = process.env, log = console.log } = {}) {
  if (
    !env.STATE_rest_counter_dir ||
    env.REST_COUNTER_DIR !== env.STATE_rest_counter_dir
  )
    return;
  try {
    const counts = collectRestCounts(env.STATE_rest_counter_dir);
    const workflow = JSON.stringify(env.GITHUB_WORKFLOW ?? '');
    const job = env.GITHUB_JOB ?? '';
    const run = `${env.GITHUB_RUN_ID ?? ''}.${env.GITHUB_RUN_ATTEMPT ?? ''}`;
    log(
      `REST_COUNT workflow=${workflow} job=${job} run=${run} total=${counts.total} ` +
        `graphql=${counts.graphql} by_route=${JSON.stringify(counts.by_route)}`,
    );
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `\nGitHub API requests (instrumented Node steps)\n\n` +
          `\`\`\`json\n${JSON.stringify(counts)}\n\`\`\`\n`,
      );
    }
  } catch {
    // A missing count or summary file must not change the job result.
  }
}

module.exports = { startRestCounter, collectRestCounts, reportRestCounter };
