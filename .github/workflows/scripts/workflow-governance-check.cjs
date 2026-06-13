#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const workflowDir = path.join(root, '.github', 'workflows');
const actionDir = path.join(root, '.github', 'actions');
const policyFile = path.join(workflowDir, 'policy.json');
const prFlowFile = path.join(root, '.github', 'pr-flow.json');

const externalUsePattern = /uses:\s*([^\s#]+@([^\s#]+))/g;
const shaPattern = /^[a-f0-9]{40}$/i;
const allowedPullRequestTarget = new Set(['pr-flow.yml', 'pr-policy.yml']);

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
  return path.relative(root, file);
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
        !allowedPullRequestTarget.has(path.basename(file))
      ) {
        errors.push(`${rel}: pull_request_target is not in the allow-list`);
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

main();
