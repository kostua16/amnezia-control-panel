/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// In YAML a plain scalar ends at " #": `run: echo "PR #${N}"` is parsed as
// `echo "PR`, which bash rejects with "unexpected EOF while looking for
// matching quote" only when the job finally runs. Multi-line scripts use a
// block scalar (`run: |`), where `#` is ordinary text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GITHUB_DIR = path.join(__dirname, '..', '..', '..');
const INLINE_RUN = /^\s*(?:-\s+)?run:[ \t]+(?![|>"'])(?<value>\S.*?)[ \t]+#.*$/;

function yamlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return yamlFiles(full);
    return /\.ya?ml$/.test(entry.name) ? [full] : [];
  });
}

function inlineRunComments(source) {
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => INLINE_RUN.test(line));
}

test('detector flags a plain run scalar that a # truncates', () => {
  const sample = '        run: echo "PR #${PR_NUMBER}; done."';
  assert.equal(inlineRunComments(sample).length, 1);
});

test('detector accepts block scalars and quoted run values', () => {
  for (const sample of [
    '        run: |\n          echo "PR #1"',
    '        run: >-\n          echo "PR #1"',
    '        run: \'echo "PR #1"\'',
    '        run: "echo PR #1"',
    '        run: npm test',
  ]) {
    assert.deepEqual(inlineRunComments(sample), [], sample);
  }
});

test('no workflow or action has a run value cut short by #', () => {
  const offenders = [];
  for (const file of yamlFiles(GITHUB_DIR)) {
    for (const { line, number } of inlineRunComments(
      fs.readFileSync(file, 'utf8'),
    )) {
      offenders.push(
        `${path.relative(GITHUB_DIR, file)}:${number}: ${line.trim()}`,
      );
    }
  }
  assert.deepEqual(offenders, []);
});
