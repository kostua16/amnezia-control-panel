/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// In YAML a plain scalar ends at " #": `run: echo "PR #${N}"` is parsed as
// `echo "PR`, which bash rejects with "unexpected EOF while looking for
// matching quote" only when the job finally runs. A deliberate trailing
// comment on a plain `run:` value (`run: npm ci # why`) is valid and passes;
// what is rejected is the parsed one-line command that leaves a quote open.
// Multi-line scripts use a block scalar (`run: |`), where `#` is ordinary text
// and are not scanned here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const GITHUB_DIR = path.join(__dirname, '..', '..', '..');

function yamlFiles() {
  const files = [];
  const workflows = path.join(GITHUB_DIR, 'workflows');
  for (const entry of fs.readdirSync(workflows, { withFileTypes: true })) {
    if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
      files.push(path.join(workflows, entry.name));
    }
  }
  const actions = path.join(GITHUB_DIR, 'actions');
  for (const entry of fs.readdirSync(actions, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of ['action.yml', 'action.yaml']) {
      const file = path.join(actions, entry.name, name);
      if (fs.existsSync(file)) files.push(file);
    }
  }
  return files;
}

// Every string stored under a `run` key, wherever it sits in the document.
function runValues(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) runValues(item, found);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'run' && typeof value === 'string') found.push(value);
      else runValues(value, found);
    }
  }
  return found;
}

// True when a one-line shell command ends inside an open '...' or "..." quote.
// `${{ ... }}` expressions are removed first and a shell comment stops the scan.
function leavesQuoteOpen(command) {
  const text = command.replace(/\$\{\{.*?\}\}/g, '');
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote === "'") {
      if (char === "'") quote = null;
    } else if (quote === '"') {
      if (char === '\\') i += 1;
      else if (char === '"') quote = null;
    } else if (char === '\\') {
      i += 1;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      break;
    }
  }
  return quote !== null;
}

function truncatedRuns(source) {
  return runValues(yaml.load(source)).filter(
    (value) => !value.includes('\n') && leavesQuoteOpen(value),
  );
}

test('detector flags a run value that a # cut short', () => {
  for (const sample of [
    '- run: echo "PR #${PR_NUMBER}; done."',
    '- "run": echo "PR #1"',
    "- run : echo 'PR #1'",
  ]) {
    assert.equal(truncatedRuns(sample).length, 1, sample);
  }
});

test('a flow mapping cut by # is not valid YAML, so parsing already rejects it', () => {
  assert.throws(() => yaml.load('- {run: echo "PR #1"}'), /flow collection/);
});

test('detector accepts valid run values', () => {
  for (const sample of [
    '- run: |\n    echo "PR #1"',
    '- run: >-\n    echo "PR #1"',
    '- run: \'echo "PR #1"\'',
    '- run: "echo PR #1"',
    '- run: npm test',
    '- run: npm ci # why this flag',
    '- run: echo "it\'s fine"',
    "- run: echo don\\'t",
    '- run: echo "${{ format(\'a {0}\', inputs.x) }}"',
  ]) {
    assert.deepEqual(truncatedRuns(sample), [], sample);
  }
});

test('there are workflow and action files to scan', () => {
  const files = yamlFiles();
  assert.ok(files.length > 10, `only ${files.length} files found`);
  assert.ok(files.some((file) => file.endsWith('auto-cover-dispatch.yml')));
});

test('no workflow or action has a run value cut short by #', () => {
  const offenders = [];
  for (const file of yamlFiles()) {
    for (const value of truncatedRuns(fs.readFileSync(file, 'utf8'))) {
      offenders.push(`${path.relative(GITHUB_DIR, file)}: ${value}`);
    }
  }
  assert.deepEqual(offenders, []);
});
