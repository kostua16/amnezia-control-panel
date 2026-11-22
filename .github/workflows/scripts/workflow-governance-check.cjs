#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const yaml = require(process.env.GOVERNANCE_YAML_PARSER || 'js-yaml');

const root = process.cwd();
const workflowDir = path.join(root, '.github', 'workflows');
const actionDir = path.join(root, '.github', 'actions');
const policyFile = path.join(workflowDir, 'policy.json');
const prFlowFile = path.join(root, '.github', 'pr-flow.json');

const externalUsePattern = /uses:\s*([^\s#]+@([^\s#]+))/g;
const shaPattern = /^[a-f0-9]{40}$/i;
const cleanupWorkflow = '.github/workflows/auto-pr-branch-cleanup.yml';
const allowedPullRequestTarget = new Set([
  cleanupWorkflow,
  '.github/workflows/pr-flow.yml',
  '.github/workflows/pr-policy.yml',
]);

function cleanupPolicyErrors(text) {
  const errors = [];
  const workflow = yaml.load(text);
  const expectedPermissions = {
    contents: 'write',
    'pull-requests': 'read',
    issues: 'write',
  };
  if (!isDeepStrictEqual(workflow?.permissions, expectedPermissions)) {
    errors.push('cleanup must use the approved workflow permissions');
  }
  const trigger = workflow?.on?.pull_request_target;
  if (
    trigger?.branches?.length !== 1 ||
    trigger.branches[0] !== 'main' ||
    trigger?.types?.length !== 1 ||
    trigger.types[0] !== 'closed' ||
    Object.hasOwn(workflow.on, 'pull_request')
  ) {
    errors.push(
      'cleanup must use pull_request_target for closed PRs targeting main',
    );
  }

  const sameRepo =
    'github.event.pull_request.head.repo.full_name == github.repository';
  const closeJobs = {
    'restore-deferred-proposal': [
      "github.event_name == 'pull_request_target'",
      sameRepo,
      'github.event.pull_request.merged != true',
    ].join(' && '),
    'delete-generated-branch': sameRepo,
  };
  const allowedJobs = new Set([
    ...Object.keys(closeJobs),
    'cleanup-orphan-branches',
  ]);
  for (const name of Object.keys(workflow?.jobs ?? {})) {
    if (!allowedJobs.has(name)) {
      errors.push(`unexpected job in privileged cleanup workflow: ${name}`);
    }
  }
  for (const [name, condition] of Object.entries(closeJobs)) {
    const job = workflow?.jobs?.[name];
    if (job?.if?.trim().replace(/\s+/g, ' ') !== condition) {
      errors.push(`${name} must retain its same-repository close guard`);
    }
    if (job?.permissions !== undefined) {
      errors.push(`${name} must inherit the approved workflow permissions`);
    }
    const steps = job?.steps ?? [];
    const checkouts = steps.filter((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    const checkout = checkouts[0];
    const snapshotIndex = steps.findIndex(
      (step) => step.uses === './.github/actions/log-rate-limit',
    );
    if (
      checkouts.length !== 1 ||
      !/^actions\/checkout@[a-f0-9]{40}$/i.test(checkout.uses) ||
      checkout.if !== undefined ||
      checkout['continue-on-error'] !== undefined ||
      checkout.with?.ref !== 'refs/heads/main' ||
      checkout.with?.['persist-credentials'] !== false ||
      ['repository', 'path'].some((key) => Object.hasOwn(checkout.with, key)) ||
      snapshotIndex <= steps.indexOf(checkout)
    ) {
      errors.push(
        `${name} must use a pinned checkout of refs/heads/main before logging`,
      );
    }
  }

  if (
    workflow?.jobs?.['cleanup-orphan-branches']?.if !==
    "github.event_name != 'pull_request_target'"
  ) {
    errors.push('the orphan sweep must skip pull_request_target events');
  }
  if (workflow?.jobs?.['cleanup-orphan-branches']?.permissions !== undefined) {
    errors.push(
      'the orphan sweep must inherit the approved workflow permissions',
    );
  }
  return errors;
}

function listFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath, predicate);
    return predicate(fullPath) ? [fullPath] : [];
  });
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function hasTopLevelPermissions(text) {
  return (
    /^permissions:\s*(\{\}\s*)?$/m.test(text) ||
    /^permissions:\s*\{\}\s*$/m.test(text)
  );
}

function jobBlocks(text) {
  const lines = text.split('\n');
  const jobsIndex = lines.findIndex((line) => line === 'jobs:');
  if (jobsIndex === -1) return [];

  const blocks = [];
  let current = null;
  for (let i = jobsIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (jobMatch) {
      if (current) blocks.push(current);
      current = { name: jobMatch[1], startLine: i + 1, lines: [line] };
      continue;
    }

    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

function main() {
  const errors = [];
  const warnings = [];
  const workflowFiles = listFiles(
    workflowDir,
    (file) => file.endsWith('.yml') || file.endsWith('.yaml'),
  );
  const actionFiles = listFiles(
    actionDir,
    (file) => path.basename(file) === 'action.yml',
  );
  const filesToCheck = [...workflowFiles, ...actionFiles];

  for (const file of filesToCheck) {
    const text = fs.readFileSync(file, 'utf8');
    const executableText = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    const rel = relative(file);
    let match;
    externalUsePattern.lastIndex = 0;
    while ((match = externalUsePattern.exec(executableText))) {
      const spec = match[1];
      const ref = match[2];
      if (!spec.startsWith('./') && !shaPattern.test(ref)) {
        errors.push(`${rel}: external action is not SHA-pinned: ${spec}`);
      }
    }

    if (rel.startsWith('.github/workflows/')) {
      if (!hasTopLevelPermissions(text)) {
        errors.push(`${rel}: missing top-level permissions block`);
      }

      if (
        /pull_request_target:/.test(text) &&
        !allowedPullRequestTarget.has(rel)
      ) {
        errors.push(`${rel}: pull_request_target is not in the allow-list`);
      }

      if (rel === cleanupWorkflow) {
        try {
          errors.push(
            ...cleanupPolicyErrors(text).map((error) => `${rel}: ${error}`),
          );
        } catch (error) {
          errors.push(`${rel}: invalid cleanup workflow: ${error.message}`);
        }
      }

      for (const block of jobBlocks(text)) {
        const body = block.lines.join('\n');
        if (
          /\n\s+runs-on:/.test(`\n${body}`) &&
          !/\n\s+timeout-minutes:/.test(`\n${body}`)
        ) {
          warnings.push(
            `${rel}:${block.startLine} job '${block.name}' has no timeout-minutes`,
          );
        }
        if (/secrets: inherit/.test(body)) {
          warnings.push(
            `${rel}:${block.startLine} job '${block.name}' uses secrets: inherit — ensure the reusable workflow has minimal permissions`,
          );
        }
      }
    }
  }

  if (!fs.existsSync(policyFile))
    errors.push('.github/workflows/policy.json missing');
  if (!fs.existsSync(prFlowFile)) errors.push('.github/pr-flow.json missing');

  const report = [
    '# Workflow Governance Report',
    '',
    `- Workflows checked: ${workflowFiles.length}`,
    `- Composite actions checked: ${actionFiles.length}`,
    `- Errors: ${errors.length}`,
    `- Warnings: ${warnings.length}`,
    '',
    '## Errors',
    ...(errors.length ? errors.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Warnings',
    ...(warnings.length ? warnings.map((item) => `- ${item}`) : ['- none']),
    '',
  ].join('\n');

  fs.writeFileSync(
    path.join(
      process.env.RUNNER_TEMP || '/tmp',
      'workflow-governance-report.md',
    ),
    report,
  );
  process.stdout.write(report);

  if (errors.length > 0) process.exit(1);
}

if (require.main === module) main();

module.exports = { cleanupPolicyErrors };
