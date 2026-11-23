/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// In YAML a plain scalar ends at " #": `run: echo "PR #${N}"` is parsed as
// `echo "PR`, which bash rejects with "unexpected EOF while looking for
// matching quote" only when the job finally runs. A deliberate trailing
// comment on a plain `run:` value (`run: npm ci # why`) is valid and passes.
//
// Scope, stated so nobody reads more into a green result: this flags a
// single-line `run` step whose parsed command ends inside an open quote. A
// cut that leaves the quotes balanced (`run: echo Building #1 of 3`) cannot be
// told apart from a deliberate comment after parsing and is not detected. The
// scanner follows bash quoting, so steps using another shell are skipped, and
// multi-line scripts (`run: |`, where `#` is ordinary text) are not scanned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const GITHUB_DIR = path.join(__dirname, '..', '..', '..');
const NON_BASH_SHELL = /^(?:pwsh|powershell|cmd|python)/;

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

// Steps of a workflow (jobs.*.steps) or a composite action (runs.steps), each
// with the shell it runs under when one is declared at step, job or file level.
function steps(doc) {
  const found = [];
  const fileShell = doc?.defaults?.run?.shell;
  const collect = (list, inheritedShell) => {
    for (const step of Array.isArray(list) ? list : []) {
      if (step && typeof step === 'object') {
        found.push({ run: step.run, shell: step.shell ?? inheritedShell });
      }
    }
  };
  for (const job of Object.values(doc?.jobs ?? {})) {
    collect(job?.steps, job?.defaults?.run?.shell ?? fileShell);
  }
  collect(doc?.runs?.steps, undefined);
  return found;
}

// Removes `${{ ... }}`, skipping '...' literals so a `}}` inside one does not
// end the expression early.
function stripExpressions(command) {
  let out = '';
  let i = 0;
  while (i < command.length) {
    if (command.startsWith('${{', i)) {
      i += 3;
      let literal = false;
      while (i < command.length) {
        if (command[i] === "'") literal = !literal;
        else if (!literal && command.startsWith('}}', i)) {
          i += 2;
          break;
        }
        i += 1;
      }
    } else {
      out += command[i];
      i += 1;
    }
  }
  return out;
}

// True when a one-line bash command ends inside an open '...' or "..." quote.
// A shell comment stops the scan.
function leavesQuoteOpen(command) {
  const text = stripExpressions(command);
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote === "'") {
      if (char === "'") quote = null;
    } else if (quote === "$'") {
      // ANSI-C quoting: a backslash escapes the next character, even a quote.
      if (char === '\\') i += 1;
      else if (char === "'") quote = null;
    } else if (quote === '"') {
      if (char === '\\') i += 1;
      else if (char === '"') quote = null;
    } else if (char === '\\') {
      i += 1;
    } else if (char === "'" && text[i - 1] === '$') {
      quote = "$'";
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      break;
    }
  }
  return quote !== null;
}

// Truncated run values with the source line they most likely come from.
function truncatedRuns(source) {
  const lines = source.split(/\r?\n/);
  return steps(yaml.load(source))
    .filter(
      ({ run, shell }) =>
        typeof run === 'string' &&
        !run.includes('\n') &&
        !NON_BASH_SHELL.test(String(shell ?? '')) &&
        leavesQuoteOpen(run),
    )
    .map(({ run }) => {
      const index = lines.findIndex(
        (line) =>
          /\brun["']?\s*:/.test(line) && line.includes(run.slice(0, 30)),
      );
      return { run, line: index === -1 ? null : index + 1 };
    });
}

const inJob = (stepYaml, extra = '') =>
  `jobs:\n  j:\n${extra}    steps:\n      ${stepYaml.replace(/\n/g, '\n      ')}\n`;

test('detector flags a run value that a # cut short', () => {
  for (const step of [
    '- run: echo "PR #${PR_NUMBER}; done."',
    '- "run": echo "PR #1"',
    "- run : echo 'PR #1'",
  ]) {
    const found = truncatedRuns(inJob(step));
    assert.equal(found.length, 1, step);
    assert.equal(found[0].line, 4, step);
  }
});

test('detector reads composite action steps too', () => {
  const source =
    'runs:\n  using: composite\n  steps:\n    - run: echo "PR #1"\n';
  assert.equal(truncatedRuns(source).length, 1);
});

test('detector accepts valid run values', () => {
  for (const step of [
    '- run: |\n    echo "PR #1"',
    '- run: >-\n    echo "PR #1"',
    '- run: \'echo "PR #1"\'',
    '- run: "echo PR #1"',
    '- run: npm test',
    '- run: npm ci # why this flag',
    '- run: echo "it\'s fine"',
    "- run: echo don\\'t",
    "- run: echo $'it\\'s fine'",
    '- run: echo "${{ format(\'a {0}\', inputs.x) }}"',
    '- run: echo "${{ fromJSON(\'{"a":"}}"}\').a }}" \'x\'',
  ]) {
    assert.deepEqual(truncatedRuns(inJob(step)), [], step);
  }
});

test('detector ignores run keys that are data, and non-bash shells', () => {
  for (const source of [
    inJob('- uses: some/action\n  with:\n    run: echo "PR #1'),
    'inputs:\n  run:\n    default: echo "PR #1\nruns:\n  using: composite\n  steps: []\n',
    inJob('- shell: pwsh\n  run: Write-Host "C:\\dir\\"'),
    inJob(
      '- run: Write-Host "C:\\dir\\"',
      '    defaults:\n      run:\n        shell: pwsh\n',
    ),
  ]) {
    assert.deepEqual(truncatedRuns(source), [], source);
  }
});

test('a flow mapping whose closing brace is eaten by # is not valid YAML', () => {
  assert.throws(() => yaml.load('- {run: echo PR #1}'));
});

test('there are workflow and action files to scan', () => {
  const files = yamlFiles();
  assert.ok(files.length > 10, `only ${files.length} files found`);
  assert.ok(files.some((file) => file.endsWith('auto-cover-dispatch.yml')));
});

test('no workflow or action step ends inside an open quote', () => {
  const offenders = [];
  for (const file of yamlFiles()) {
    for (const { run, line } of truncatedRuns(fs.readFileSync(file, 'utf8'))) {
      offenders.push(
        `${path.relative(GITHUB_DIR, file)}:${line ?? '?'}: ${run}`,
      );
    }
  }
  assert.deepEqual(offenders, []);
});
