/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
} = require('node:fs');
const { join } = require('node:path');
const {
  METHODS = [],
  ROUTES = [],
  sameDirectory,
} = require('./rest-preload.cjs');

const ROUTE_KEYS = new Set(
  [...METHODS, 'OTHER'].flatMap((method) =>
    [...ROUTES, '/other'].map((route) => `${method} ${route}`),
  ),
);

function startRestCounter(env = process.env, log = console.log) {
  if (env['INPUT_REST-COUNTER'] !== 'true') return;
  let dir;
  let preload;
  try {
    if (env.REST_COUNTER_DIR) {
      appendFileSync(env.GITHUB_STATE, 'rest_counter_skip=true\n');
      return;
    }
    if (
      !env.RUNNER_TEMP ||
      !env.GITHUB_ENV ||
      !env.GITHUB_OUTPUT ||
      !env.GITHUB_STATE
    ) {
      log(
        '::warning::REST counter setup unavailable (missing-runner-environment)',
      );
      return;
    }
    // Reject paths that cannot be written as file commands or quoted for
    // descendant Node processes before creating any telemetry files.
    const unsafePath = /["\r\n]/;
    const temp = unsafePath.test(env.RUNNER_TEMP)
      ? env.RUNNER_TEMP
      : realpathSync(env.RUNNER_TEMP);
    if (unsafePath.test(temp)) {
      log('::warning::REST counter setup unavailable (invalid-runner-path)');
      return;
    }
    dir = mkdtempSync(join(temp, 'rest-counter-'));
    preload = join(dir, 'rest-preload.cjs');
    // Keep the preload available when later checkout steps replace the workspace.
    copyFileSync(join(__dirname, 'rest-preload.cjs'), preload);
    appendFileSync(env.GITHUB_STATE, `rest_counter_dir=${dir}\n`);
    appendFileSync(env.GITHUB_ENV, `REST_COUNTER_DIR=${dir}\n`);
    appendFileSync(env.GITHUB_OUTPUT, `rest-counter-preload=${preload}\n`);
  } catch {
    if (dir) {
      try {
        unlinkSync(preload);
      } catch {
        /* The copy may never have completed. */
      }
      try {
        rmdirSync(dir);
      } catch {
        /* Runner temp is cleaned by the runner. */
      }
    }
    log('::warning::REST counter setup unavailable (setup-io)');
  }
}

function collectRestCounts(dir) {
  let total = 0;
  let graphql = 0;
  let instrumented = 0;
  let unreadable = 0;
  const routes = new Map();
  for (const file of readdirSync(dir)) {
    if (!/^requests-[a-f0-9-]+\.log$/.test(file)) continue;
    let records;
    try {
      records = readFileSync(join(dir, file), 'utf8').split('\n');
    } catch {
      unreadable += 1;
      continue;
    }
    // Ignore incomplete writes. A newer snapshot can know route templates
    // this copy does not. Preserve those counts without emitting unknown text.
    records.pop();
    if (records[0] === 'attached') instrumented += 1;
    for (const route of records) {
      if (route === 'graphql') {
        graphql += 1;
        continue;
      }
      const method = /^([A-Z]+) \/\S+$/.exec(route)?.[1];
      if (!method) continue;
      const key = ROUTE_KEYS.has(route)
        ? route
        : `${METHODS.includes(method) ? method : 'OTHER'} /other`;
      total += 1;
      routes.set(key, (routes.get(key) ?? 0) + 1);
    }
  }
  return {
    total,
    graphql,
    instrumented,
    unreadable,
    by_route: Object.fromEntries([...routes].sort()),
  };
}

function reportRestCounter({ env = process.env, log = console.log } = {}) {
  if (
    env['INPUT_REST-COUNTER'] !== 'true' ||
    env.STATE_rest_counter_skip === 'true'
  )
    return;
  const workflow = JSON.stringify(env.GITHUB_WORKFLOW ?? '');
  const job = env.GITHUB_JOB ?? '';
  const run = `${env.GITHUB_RUN_ID ?? ''}.${env.GITHUB_RUN_ATTEMPT ?? ''}`;
  const prefix = `REST_COUNT workflow=${workflow} job=${job} run=${run}`;
  const dir = env.STATE_rest_counter_dir;
  if (!dir) {
    log(`${prefix} status=unavailable reason=setup-failed`);
    return;
  }
  let counts;
  try {
    if (
      !env.REST_COUNTER_DIR ||
      (env.REST_COUNTER_DIR !== dir &&
        !sameDirectory?.(env.REST_COUNTER_DIR, dir))
    ) {
      log(`${prefix} status=unavailable reason=directory-changed`);
      return;
    }
    counts = collectRestCounts(dir);
  } catch {
    log(`${prefix} status=unavailable reason=read-failed`);
    return;
  }
  const { total, graphql, instrumented, unreadable, by_route } = counts;
  const status =
    total || graphql || instrumented || unreadable
      ? ''
      : ' status=uninstrumented';
  log(
    `${prefix}${status} total=${total} graphql=${graphql} instrumented=${instrumented} unreadable=${unreadable} by_route=${JSON.stringify(by_route)}`,
  );
  try {
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `\nGitHub API requests (instrumented Node steps)\n\n` +
          `\`\`\`json\n${JSON.stringify(counts)}\n\`\`\`\n`,
      );
    }
  } catch {
    // A missing summary file must not change the job result.
  }
}

module.exports = { startRestCounter, collectRestCounts, reportRestCounter };
