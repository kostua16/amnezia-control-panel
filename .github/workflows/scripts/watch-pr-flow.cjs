#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require('child_process');

const DEFAULT_ORCHESTRATOR_REF = 'main';
const DEFAULT_ORCHESTRATOR_WORKFLOW = 'pr-flow.yml';
const STALE_DRAFT_LABEL = 'flow/draft';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[key] =
      argv[index + 1] && !argv[index + 1].startsWith('--')
        ? argv[++index]
        : 'true';
  }
  return args;
}

function asBoolean(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function normalizeLabels(labels) {
  return (labels ?? []).map((label) =>
    typeof label === 'string' ? label : label.name,
  );
}

function summarizePr(pr) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
  };
}

function selectStaleDraftPrs(prs, labelName = STALE_DRAFT_LABEL) {
  return (prs ?? []).filter((pr) => {
    const labels = normalizeLabels(pr.labels);
    const isOpen = !pr.state || pr.state === 'OPEN';
    return isOpen && pr.isDraft === false && labels.includes(labelName);
  });
}

function run(command, args) {
  return (
    execFileSync(command, args, {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) ?? ''
  ).trim();
}

function runJson(command, args, fallback = []) {
  const output = run(command, args);
  return output ? JSON.parse(output) : fallback;
}

function listOpenPullRequests({ runJsonCommand = runJson } = {}) {
  return runJsonCommand(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '200',
      '--json',
      'number,title,url,state,isDraft,labels',
    ],
    [],
  );
}

function buildDispatchArgs({
  prNumber,
  workflow = DEFAULT_ORCHESTRATOR_WORKFLOW,
  ref = DEFAULT_ORCHESTRATOR_REF,
}) {
  return [
    'workflow',
    'run',
    workflow,
    '--ref',
    ref,
    '-f',
    `pr_number=${prNumber}`,
    '-f',
    'dry_run=false',
  ];
}

function dispatchOrchestrator(pr, { runCommand = run, workflow, ref } = {}) {
  runCommand('gh', buildDispatchArgs({ prNumber: pr.number, workflow, ref }));
}

function runWatchdog({
  dryRun = false,
  listPullRequests = listOpenPullRequests,
  dispatch = dispatchOrchestrator,
  workflow = DEFAULT_ORCHESTRATOR_WORKFLOW,
  ref = DEFAULT_ORCHESTRATOR_REF,
} = {}) {
  const pullRequests = listPullRequests();
  const selected = selectStaleDraftPrs(pullRequests);
  const dispatched = [];

  if (!dryRun) {
    for (const pr of selected) {
      dispatch(pr, { workflow, ref });
      dispatched.push(summarizePr(pr));
    }
  }

  return {
    status: 'ok',
    dryRun,
    totalOpenPrs: pullRequests.length,
    selected: selected.map(summarizePr),
    dispatched,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = asBoolean(args.dryRun || process.env.DRY_RUN || 'false');
  const workflow = args.workflow || DEFAULT_ORCHESTRATOR_WORKFLOW;
  const ref = args.ref || DEFAULT_ORCHESTRATOR_REF;
  const summary = runWatchdog({ dryRun, workflow, ref });

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  buildDispatchArgs,
  runWatchdog,
  selectStaleDraftPrs,
};
