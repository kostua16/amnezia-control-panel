#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const {
  fetchOpenPrFlowPage,
  PAGE_SIZE,
} = require('./lib/open-pr-flow-graphql.cjs');
const { isTransient } = require('./lib/retry.cjs');
const {
  createAutoCoverGraphqlRunner,
} = require('./fetch-auto-cover-context.cjs');
const {
  getRequiredCheckStatus,
  mapJobConclusion,
} = require('./required-check-evidence.cjs');
const { selectStalePrs } = require('./watch-pr-flow.cjs');
const config = require('../../pr-flow.json');

const RECOVERY_CRON = '7,22,37,52 * * * *';
const READY_CONTEXT = 'pr-flow/ready';
const UNREADABLE_STATUSES = [{ context: READY_CONTEXT }];
const CHECK_RESCUE = 'checks-completed-after-ready';
const CHECK_COMPLETION_GRACE_MS = 120_000;
const MIN_GRAPHQL_REMAINING = 5;
const SHADOW_RUN_TITLE = 'PR Flow Watchdog (shadow enabled)';
const COOLDOWN_MS = 5 * 60_000;

function checkShadowCooldown({
  repository,
  branch,
  runId,
  now = Date.now(),
  execGh = execFileSync,
  log = console.error,
}) {
  // Workflow run history is available in one read. Ignore off-mode runs,
  // queued runs and the current run (including retries with the same ID).
  const { workflow_runs: runs } = JSON.parse(
    execGh(
      'gh',
      [
        'api',
        '--method',
        'GET',
        `repos/${repository}/actions/workflows/pr-flow-watchdog.yml/runs`,
        '-f',
        `branch=${branch}`,
        '-f',
        'status=completed',
        '-f',
        'per_page=100',
      ],
      { encoding: 'utf8', timeout: 15_000 },
    ),
  );
  const lastStart = runs.reduce((latest, run) => {
    if (
      String(run.id) === runId ||
      run.display_title !== SHADOW_RUN_TITLE ||
      ['cancelled', 'skipped'].includes(run.conclusion)
    )
      return latest;
    const started = Date.parse(run.run_started_at);
    return started <= now && started > latest ? started : latest;
  }, -Infinity);
  const age = now - lastStart;
  if (age >= COOLDOWN_MS) return true;
  log(`skipped: last shadow run ${Math.floor(age / 60_000)} min ago`);
  return false;
}

function completedRequiredChecks(pr, required, nowMs) {
  const ready = pr.statuses?.find((status) => status.context === READY_CONTEXT);
  if (
    !pr.labels?.includes('flow/checks-pending') ||
    ready?.state !== 'pending' ||
    !pr.checks ||
    !pr.suitesComplete ||
    !required.length
  )
    return false;

  const checks = [];
  const requiredCompletions = [];
  for (const { workflow, names } of required) {
    if (!workflow || !names.length) return false;
    const runs = pr.observedRuns.filter((run) => run.workflow === workflow);
    const [run] = runs;
    // Only accept a single first attempt with an explicit suite association.
    // A rerun can reuse the run ID and the rollup may mix jobs across attempts.
    if (
      runs.length !== 1 ||
      !run.suiteId ||
      run.attempt !== 1 ||
      run.status !== 'completed' ||
      !['pull_request', 'pull_request_target'].includes(run.event)
    )
      return false;
    const jobs = pr.checks
      .filter((check) => check.suiteId === run.suiteId)
      .map((check) => ({ ...check, ...mapJobConclusion(check), workflow }));
    checks.push(...jobs);
    for (const name of names) {
      const matches = jobs.filter((job) => job.name === name);
      const [job] = matches;
      if (
        matches.length !== 1 ||
        !['pass', 'fail', 'skip', 'cancel'].includes(job.bucket) ||
        !Number.isFinite(Date.parse(job.completedAt))
      )
        return false;
      requiredCompletions.push(Date.parse(job.completedAt));
    }
  }

  const result = getRequiredCheckStatus(checks, required);
  const latest = Math.max(...requiredCompletions);
  return (
    !result.missing.length &&
    !result.pending.length &&
    latest > Date.parse(ready.created_at) &&
    nowMs - latest >= CHECK_COMPLETION_GRACE_MS
  );
}

function captureHeads(observations, movedHeads) {
  const numbers = new Map();
  for (const pr of observations) {
    const previous = numbers.get(pr.number);
    if (previous && previous.headRefOid !== pr.headRefOid)
      movedHeads.add(pr.number);
    if (!previous) numbers.set(pr.number, pr);
  }
  return [...numbers.values()].filter((pr) => !movedHeads.has(pr.number));
}

function planSweep(
  observations,
  {
    now,
    recoverySlot = false,
    getStatusHistory = () => null,
    requiredChecks = config.checks.required,
  } = {},
) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs) || now === null)
    throw new Error('A valid sweep time is required.');
  const unknown = [];
  const movedHeads = new Set();
  const eligible = captureHeads(observations, movedHeads).filter((pr) => {
    if (!pr.state || typeof pr.isDraft !== 'boolean') {
      unknown.push({ number: pr.number, evidence: ['eligibility'] });
    }
    if (pr.state !== 'OPEN' || pr.isDraft !== false) return false;
    if (!pr.headVerified || pr.labels === null || pr.statuses === null) {
      unknown.push({
        number: pr.number,
        evidence: [
          ...(!pr.headVerified ? ['head'] : []),
          ...(pr.labels === null ? ['labels'] : []),
          ...(pr.statuses === null ? ['statuses'] : []),
        ],
      });
    }
    return pr.headVerified;
  });
  for (const number of movedHeads) unknown.push({ number, evidence: ['head'] });
  const stale = selectStalePrs(eligible, {
    now: nowMs,
    getStatuses: (pr) => pr.statuses ?? UNREADABLE_STATUSES,
    getStatusHistory(pr) {
      if (!recoverySlot) return [];
      const history = getStatusHistory(pr);
      if (history === null)
        unknown.push({ number: pr.number, evidence: ['history'] });
      return history;
    },
  });
  const reasonsByPr = new Map(
    stale.map((pr) => [pr.number, pr.recoveryReasons]),
  );
  const candidates = eligible.flatMap((pr) => {
    const reasons = reasonsByPr.get(pr.number) ?? [];
    if (completedRequiredChecks(pr, requiredChecks, nowMs))
      reasons.push(CHECK_RESCUE);
    return reasons.length
      ? [{ number: pr.number, head: pr.headRefOid, reasons }]
      : [];
  });
  return { candidates, unknown };
}

function readAllPages({ owner, repo, runGraphql, movedHeads }) {
  const observations = [];
  const cursors = new Set();
  let after = null;
  let first = PAGE_SIZE;
  for (;;) {
    let page;
    try {
      page = fetchOpenPrFlowPage({ owner, repo, after, first, runGraphql });
    } catch (error) {
      const detail = `${error.code ?? ''} ${error.message} ${error.stderr ?? ''}`;
      if (
        first <= 4 ||
        !/ETIMEDOUT|ENOBUFS|resource.limit|timed? out|\b50[24]\b/i.test(detail)
      )
        throw error;
      first /= 2;
      continue;
    }
    observations.push(...page.observations);
    if (!page.pageInfo.hasNextPage) break;
    if (page.rateLimit?.remaining < MIN_GRAPHQL_REMAINING) {
      throw new Error('GraphQL budget is too low for a complete shadow scan.');
    }
    after = page.pageInfo.endCursor;
    if (typeof after !== 'string' || !after.trim() || cursors.has(after)) {
      throw new Error(
        'GraphQL open PR pagination returned a missing or repeated cursor.',
      );
    }
    cursors.add(after);
  }
  return captureHeads(observations, movedHeads);
}

function createReadOnlyGraphql(execGh) {
  const { runQuery } = createAutoCoverGraphqlRunner({
    execFileSyncImpl: execGh,
  });
  return (query, variables) => {
    try {
      return runQuery(query, variables);
    } catch (error) {
      // gh exits nonzero on GraphQL errors, even with a usable response body.
      let response;
      try {
        response = JSON.parse(error.stdout ?? '');
      } catch {
        throw error;
      }
      if (Array.isArray(response?.errors)) return response;
      throw error;
    }
  };
}

function compareWatchdog(
  observations,
  { now, readStatuses, getStatusHistory, plan },
) {
  const unknown = new Set(plan.unknown.map(({ number }) => number));
  const incumbent = selectStalePrs(
    observations.filter(
      (pr) => pr.headVerified && pr.labels !== null && !unknown.has(pr.number),
    ),
    {
      now,
      getStatuses(pr) {
        const statuses = readStatuses(pr, 'status');
        if (statuses === null) unknown.add(pr.number);
        return statuses ?? UNREADABLE_STATUSES;
      },
      getStatusHistory(pr) {
        const history = getStatusHistory(pr);
        if (history === null) unknown.add(pr.number);
        return history;
      },
    },
  );
  const incumbentReasons = new Map(
    incumbent.map((pr) => [pr.number, pr.recoveryReasons]),
  );
  const shadowReasons = new Map(
    plan.candidates.map(({ number, reasons }) => [
      number,
      reasons.filter((reason) => reason !== CHECK_RESCUE),
    ]),
  );
  const differences = observations.flatMap(({ number, headRefOid }) => {
    if (unknown.has(number)) return [];
    const shadow = shadowReasons.get(number) ?? [];
    const watchdog = incumbentReasons.get(number) ?? [];
    return JSON.stringify(shadow) === JSON.stringify(watchdog)
      ? []
      : [{ number, head: headRefOid, shadow, watchdog }];
  });
  return {
    scope: 'status-evidence-only',
    differences,
    unknown: [...unknown],
    incumbent: incumbent
      .filter(({ number }) => !unknown.has(number))
      .map(({ number, headRefOid, recoveryReasons }) => ({
        number,
        head: headRefOid,
        reasons: recoveryReasons,
      })),
  };
}

function scanPrFlow({
  mode,
  repository,
  schedule,
  triggerEvent = null,
  now = new Date().toISOString(),
  execGh = execFileSync,
  runGraphql,
  log = console.log,
} = {}) {
  if (mode !== 'shadow') return { status: 'off' };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? ''))
    throw new Error('GITHUB_REPOSITORY must be owner/repo.');
  const [owner, repo] = repository.split('/');
  const graphql = runGraphql ?? createReadOnlyGraphql(execGh);
  const pages = [];
  const started = performance.now();
  const recoverySlot = schedule === RECOVERY_CRON;
  const movedHeads = new Set();
  const summary = (details) => {
    const result = {
      ...details,
      recoverySlot,
      pages,
      cost: pages.reduce((total, page) => total + (page.cost ?? 0), 0),
      elapsedMs: Math.round(performance.now() - started),
    };
    log(`PR flow shadow ${JSON.stringify(result)}`);
    const telemetry = {
      triggerEvent,
      status: result.status,
      recoverySlot,
      cost: result.cost,
      remaining: pages.at(-1)?.remaining ?? null,
      openPrs: result.openPrs ?? null,
      candidatePrs: result.candidatePrs ?? null,
      comparisonDiffs: result.comparison?.differences ?? null,
    };
    log(`SHADOW_SWEEP_SUMMARY ${JSON.stringify(telemetry)}`);
    return result;
  };
  let observations;
  try {
    observations = readAllPages({
      owner,
      repo,
      movedHeads,
      runGraphql(query, variables) {
        const pageStarted = performance.now();
        let response;
        try {
          response = graphql(query, variables);
          return response;
        } finally {
          const {
            cost = null,
            remaining = null,
            limit = null,
            resetAt = null,
          } = response?.data?.rateLimit ?? {};
          pages.push({
            first: variables.first,
            cost,
            remaining,
            limit,
            resetAt,
            elapsedMs: Math.round(performance.now() - pageStarted),
          });
        }
      },
    });
  } catch (error) {
    return summary({
      status: 'unavailable',
      error: String(error.stderr || error.message).split(/\r?\n/)[0],
    });
  }

  const comparisonDeadline = performance.now() + 90_000;
  let restReads = 0;
  let restThrottled = false;
  const statusReadsByEndpoint = new Map();
  const fetchStatuses = (endpoint, kind) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = Math.floor(comparisonDeadline - performance.now());
      if (restThrottled || remaining <= 0) return null;
      try {
        restReads += 1;
        const value = JSON.parse(
          execGh('gh', ['api', '--method', 'GET', endpoint], {
            encoding: 'utf8',
            timeout: Math.min(remaining, 15_000),
            maxBuffer: 8 * 1024 * 1024,
          }),
        );
        return Array.isArray(kind === 'status' ? value?.statuses : value)
          ? value
          : null;
      } catch (error) {
        const detail = String(error.stderr || error.message);
        restThrottled = /HTTP 429|rate limit/i.test(detail);
        if (
          restThrottled ||
          !(
            isTransient(detail) ||
            error.code === 'ETIMEDOUT' ||
            error.signal === 'SIGTERM'
          )
        )
          return null;
      }
    }
    return null;
  };
  const readStatuses = (pr, kind) => {
    const suffix = kind === 'status' ? 'status' : 'statuses?per_page=100';
    const endpoint = `repos/${repository}/commits/${pr.headRefOid}/${suffix}`;
    if (!statusReadsByEndpoint.has(endpoint)) {
      statusReadsByEndpoint.set(endpoint, fetchStatuses(endpoint, kind));
    }
    return statusReadsByEndpoint.get(endpoint);
  };
  const getStatusHistory = (pr) => readStatuses(pr, 'history');
  const plan = planSweep(observations, { now, recoverySlot, getStatusHistory });
  const comparison = recoverySlot
    ? compareWatchdog(observations, {
        now,
        readStatuses,
        getStatusHistory,
        plan,
      })
    : null;
  for (const { number, head, reasons } of plan.candidates) {
    for (const reason of reasons)
      log(`would wake PR #${number} because ${reason} (head=${head})`);
  }
  return summary({
    status: 'ok',
    openPrs: observations.length + movedHeads.size,
    candidatePrs: plan.candidates.length,
    unknown: plan.unknown,
    movedHeads: [...movedHeads],
    restReads,
    restThrottled,
    comparison,
    observedRuns: observations.reduce(
      (total, pr) => total + pr.observedRuns.length,
      0,
    ),
  });
}

if (require.main === module) {
  if (process.argv[2] === '--check-cooldown') {
    const scan = checkShadowCooldown({
      repository: process.env.GITHUB_REPOSITORY,
      branch: process.env.GITHUB_REF_NAME,
      runId: process.env.GITHUB_RUN_ID,
    });
    console.log(`scan=${scan}`);
  } else {
    scanPrFlow({
      mode: process.env.PR_FLOW_SWEEP_MODE,
      repository: process.env.GITHUB_REPOSITORY,
      schedule: process.env.PR_FLOW_SWEEP_SCHEDULE,
      triggerEvent: process.env.GITHUB_EVENT_NAME,
    });
  }
}

module.exports = { checkShadowCooldown, planSweep, scanPrFlow };
