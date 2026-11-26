/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const {
  accessSync,
  appendFileSync,
  constants,
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { delimiter, isAbsolute, join, resolve } = require('node:path');
const {
  findGhOnPath,
  isExecutableFile,
  restCounterEnabled,
} = require('./gh-counter.cjs');
const { METHODS, ROUTES, sameDirectory } = require('./rest-routes.cjs');
const GH_SETUP_FAILURE = 'gh-setup-failure';
const REASON_CODE = /^[a-z][a-z0-9-]{0,39}$/;

function writeCounterOutputs(file, dir) {
  if (!file || /["\r\n]/.test(dir)) return;
  appendFileSync(
    file,
    `rest-counter-preload=${join(dir, 'rest-preload.cjs')}\nrest-counter-enabled=true\n`,
  );
}

const ROUTE_KEYS = new Set(
  [...METHODS, 'OTHER'].flatMap((method) =>
    [...ROUTES, '/other'].map((route) => `${method} ${route}`),
  ),
);

function startRestCounter(env = process.env, log = console.log) {
  if (!restCounterEnabled(env['INPUT_REST-COUNTER'])) return;
  let dir;
  let preload;
  try {
    if (env.REST_COUNTER_DIR) {
      if (env.GITHUB_STATE)
        appendFileSync(env.GITHUB_STATE, 'rest_counter_skip=true\n');
      writeCounterOutputs(env.GITHUB_OUTPUT, env.REST_COUNTER_DIR);
      return env.REST_COUNTER_DIR;
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
    copyFileSync(
      join(__dirname, 'rest-routes.cjs'),
      join(dir, 'rest-routes.cjs'),
    );
    appendFileSync(env.GITHUB_STATE, `rest_counter_dir=${dir}\n`);
    appendFileSync(env.GITHUB_ENV, `REST_COUNTER_DIR=${dir}\n`);
    writeCounterOutputs(env.GITHUB_OUTPUT, dir);
    return dir;
  } catch {
    if (dir) {
      try {
        unlinkSync(preload);
      } catch {
        /* The copy may never have completed. */
      }
      try {
        unlinkSync(join(dir, 'rest-routes.cjs'));
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
  const via = { node: 0, gh: 0 };
  const graphql_via = { node: 0, gh: 0 };
  const routes = new Map();
  for (const file of readdirSync(dir)) {
    const match = /^(gh-)?requests-[a-f0-9-]+\.log$/.exec(file);
    if (!match) continue;
    const source = match[1] ? 'gh' : 'node';
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
        graphql_via[source] += 1;
        continue;
      }
      const method = /^([A-Z]+) \/\S+$/.exec(route)?.[1];
      if (!method) continue;
      const key = ROUTE_KEYS.has(route)
        ? route
        : `${METHODS.includes(method) ? method : 'OTHER'} /other`;
      total += 1;
      via[source] += 1;
      routes.set(key, (routes.get(key) ?? 0) + 1);
    }
  }
  return {
    total,
    graphql,
    instrumented,
    unreadable,
    via,
    graphql_via,
    by_route: Object.fromEntries([...routes].sort()),
  };
}

function ghLauncherIssue(dir, path) {
  const bin = join(dir, 'gh-bin');
  if (!path?.split(delimiter).some((entry) => resolve(entry) === bin))
    return readGhSetupFailure(dir);

  const launcher = join(bin, 'gh');
  if (!isExecutableFile(launcher)) return 'launcher-unusable';
  let node;
  try {
    const quotedNode = /^node_bin='([^\r\n]*)'\r?$/m.exec(
      readFileSync(launcher, 'utf8'),
    )?.[1];
    node = quotedNode?.replaceAll("'\\''", "'");
  } catch {
    return 'launcher-unusable';
  }
  if (!node || !isAbsolute(node) || !isExecutableFile(node))
    return 'node-unusable';

  const observer = join(bin, 'gh-counter.cjs');
  try {
    accessSync(observer, constants.R_OK);
    const stat = statSync(observer);
    if (!stat.isFile() || stat.size === 0) return 'observer-unusable';
  } catch {
    return 'observer-unusable';
  }
  if (findGhOnPath(path) !== launcher) return 'launcher-shadowed';
  return undefined;
}

function reportGhInstallFailure(dir, reason, log = console.log) {
  const code =
    typeof reason === 'string' && REASON_CODE.test(reason)
      ? reason
      : 'setup-failed';
  log(`::warning::GitHub CLI request counting unavailable (${code})`);
  try {
    writeFileSync(join(dir, GH_SETUP_FAILURE), `${code}\n`, { mode: 0o600 });
  } catch {
    // The post report can still detect the missing launcher.
  }
}

function readGhSetupFailure(dir) {
  try {
    const reason = readFileSync(join(dir, GH_SETUP_FAILURE), 'utf8').trim();
    if (REASON_CODE.test(reason)) return reason;
  } catch {
    // The install step may have been skipped.
  }
  return 'not-installed';
}

function restCountPrefix({ workflow, job, runId, attempt }) {
  const safeJob = job && /^[\w-]+$/.test(job) ? job : 'unknown';
  const id = runId && /^\d+$/.test(runId) ? runId : 'unknown';
  const number = attempt && /^\d+$/.test(attempt) ? attempt : 'unknown';
  return `REST_COUNT workflow=${JSON.stringify(workflow || 'unknown')} job=${safeJob} run=${id}.${number}`;
}

function formatUnavailableLine({ reason, ...identity }) {
  const code =
    (typeof reason === 'string' ? reason : '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .slice(0, 40)
      .replace(/^[^a-z]+|-+$/g, '') || 'invalid-reason';
  return `${restCountPrefix(identity)} status=unavailable reason=${code} total=0 graphql=0 by_route={}`;
}

function reportRestCounter({
  env = process.env,
  log = console.log,
  platform = process.platform,
} = {}) {
  if (
    !restCounterEnabled(env['INPUT_REST-COUNTER']) ||
    env.STATE_rest_counter_skip === 'true'
  )
    return;
  const identity = {
    workflow: env.GITHUB_WORKFLOW,
    job: env.GITHUB_JOB,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
  };
  const dir = env.STATE_rest_counter_dir;
  if (!dir) {
    log(formatUnavailableLine({ ...identity, reason: 'setup-failed' }));
    return;
  }
  if (!sameDirectory?.(env.REST_COUNTER_DIR, dir)) {
    log(formatUnavailableLine({ ...identity, reason: 'directory-changed' }));
    return;
  }
  let counts;
  try {
    counts = collectRestCounts(dir);
  } catch {
    log(formatUnavailableLine({ ...identity, reason: 'read-failed' }));
    return;
  }
  const {
    total,
    graphql,
    instrumented,
    unreadable,
    via,
    graphql_via,
    by_route,
  } = counts;
  const status =
    total || graphql || instrumented || unreadable
      ? ''
      : ' status=uninstrumented';
  let ghReason;
  if (via.gh === 0 && graphql_via.gh === 0) {
    ghReason =
      platform === 'linux'
        ? ghLauncherIssue(dir, env.PATH)
        : ['win32', 'darwin'].includes(platform)
          ? 'unsupported-platform'
          : 'unknown-platform';
  }
  const ghStatus = ghReason ? 'unavailable' : 'ok';
  log(
    `${restCountPrefix(identity)}${status} total=${total} graphql=${graphql} instrumented=${instrumented} unreadable=${unreadable} via=${JSON.stringify(via)} graphql_via=${JSON.stringify(graphql_via)} gh_status=${ghStatus}${ghReason ? ` gh_reason=${ghReason}` : ''} by_route=${JSON.stringify(by_route)}`,
  );
  try {
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `\nGitHub API requests (instrumented Node and gh)\n\n` +
          `\`\`\`json\n${JSON.stringify({ ...counts, gh_status: ghStatus, gh_reason: ghReason })}\n\`\`\`\n`,
      );
    }
  } catch {
    // A missing summary file must not change the job result.
  }
}

module.exports = {
  startRestCounter,
  collectRestCounts,
  formatUnavailableLine,
  reportGhInstallFailure,
  reportRestCounter,
};
