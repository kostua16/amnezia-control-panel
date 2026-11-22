/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// The maintainer association set is enforced by policy.json at runtime
// (resolve JS gates, issue-catch-up, triage's dispatch gate), but GitHub
// Actions expressions cannot read files: deepseek-code-review.yml spells
// the associations out in its concurrency group and resolve-pr `if`, and
// triage.yml in two fromJSON lists. If policy.json ever drifts from those
// literals, the concurrency group is the one surface that drifts weak — a
// stale association can cancel an in-progress review (cancel-in-progress)
// before the resolve gate rejects the new run. This test pins every literal
// to the policy.

const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isAuthorizedTriageAuthor,
} = require('../authorize-triage-dispatch.cjs');

const workflowsDir = path.join(__dirname, '..', '..');
const policy = JSON.parse(
  fs.readFileSync(path.join(workflowsDir, 'policy.json'), 'utf8'),
);
const expected = [...policy.maintainerAssociations].sort();

function readWorkflow(name) {
  return fs.readFileSync(path.join(workflowsDir, name), 'utf8');
}

test('deepseek-code-review association literals match policy.maintainerAssociations', () => {
  const content = readWorkflow('deepseek-code-review.yml');
  const literals = [
    ...content.matchAll(
      /github\.event\.comment\.author_association == '([A-Z_]+)'/g,
    ),
  ].map((m) => m[1]);
  // One literal set in the concurrency group, one in the resolve-pr job `if`.
  assert.equal(literals.length, 2 * expected.length);
  assert.deepEqual([...new Set(literals)].sort(), expected);
});

test('triage.yml fromJSON author-gate lists match policy.maintainerAssociations', () => {
  const content = readWorkflow('triage.yml');
  const lists = [
    ...content.matchAll(
      /fromJSON\('(\[[^']+\])'\),\s*github\.event\.(?:issue|comment)\.author_association\)/g,
    ),
  ].map((m) => JSON.parse(m[1]));
  // One gate for the `issues` event, one for `issue_comment`.
  assert.ok(lists.length >= 2, 'expected both author gates');
  for (const list of lists) {
    assert.deepEqual([...list].sort(), expected);
  }
});

test('triage dispatch authorization gates the single configured agent step', () => {
  const steps = readWorkflow('triage.yml')
    .split(/^ {6}- /m)
    .slice(1);
  const details = steps.filter((step) =>
    /^ {8}id: issue_details\s*$/m.test(step),
  );
  assert.equal(details.length, 1);
  const [producer] = details;
  const commands = producer.split(/\r?\n/).map((line) => line.trim());
  const projection = commands
    .find((line) => line.startsWith('--jq '))
    ?.match(/^--jq '\{([^}]+)\}' > \/tmp\/issue\.json$/)?.[1];
  assert.ok(projection, 'missing active issue metadata projection');
  const fields = projection.split(',').map((field) => field.trim());
  for (const [output, field] of [
    ['author', '.user.login'],
    ['author_association', '.author_association'],
    ['author_type', '.user.type'],
  ]) {
    assert.ok(
      fields.includes(`${output}: ${field}`),
      `missing projection for ${output}`,
    );
    assert.ok(
      commands.includes(
        `echo "${output}=\$(jq -r .${output} /tmp/issue.json)"`,
      ),
      `missing step output ${output}`,
    );
  }
  assert.ok(commands.includes('} >> "$GITHUB_OUTPUT"'));

  const gates = steps.filter((step) =>
    /^ {8}id: dispatch_gate\s*$/m.test(step),
  );
  assert.equal(
    gates.length,
    1,
    'expected exactly one dispatch authorization step',
  );
  const [gate] = gates;
  assert.match(gate, /echo "authorized=\$authorized" >> "\$GITHUB_OUTPUT"/);
  assert.match(
    gate,
    /node \.github\/workflows\/scripts\/authorize-triage-dispatch\.cjs/,
  );
  assert.match(
    gate,
    /AUTHOR_ASSOCIATION: \$\{\{ steps\.issue_details\.outputs\.author_association \}\}/,
  );
  assert.match(
    gate,
    /AUTHOR_LOGIN: \$\{\{ steps\.issue_details\.outputs\.author \}\}/,
  );
  assert.match(
    gate,
    /AUTHOR_TYPE: \$\{\{ steps\.issue_details\.outputs\.author_type \}\}/,
  );

  const agents = steps.filter((step) =>
    /^(?: {8})?uses: \.\/\.github\/actions\/run-zai[ \t]*$/m.test(step),
  );
  assert.equal(agents.length, 1);
  const [agent] = agents;
  assert.match(
    agent,
    /^ {8}if: github\.event_name != 'workflow_dispatch' \|\| steps\.dispatch_gate\.outputs\.authorized == 'true'\s*$/m,
  );
  assert.match(agent, /^ {10}api-key:/m);
});

test('triage dispatch accepts maintainers and only allowlisted bots', () => {
  for (const [association, type, login, authorized] of [
    ['OWNER', 'User', 'maintainer', true],
    ['NONE', 'Bot', 'github-actions[bot]', true],
    ['NONE', 'Bot', 'unlisted-app[bot]', false],
    ['CONTRIBUTOR', 'User', 'external', false],
    ['NONE', 'User', 'github-actions[bot]', false],
    [undefined, undefined, undefined, false],
  ]) {
    assert.equal(
      isAuthorizedTriageAuthor(association, type, login),
      authorized,
      `${association}/${type}/${login}`,
    );
  }
});

test('triage dispatch CLI reads the workflow author inputs', () => {
  const script = path.join(
    workflowsDir,
    'scripts',
    'authorize-triage-dispatch.cjs',
  );
  for (const [AUTHOR_ASSOCIATION, AUTHOR_TYPE, AUTHOR_LOGIN, expected] of [
    ['OWNER', 'User', 'maintainer', 'true'],
    ['NONE', 'Bot', 'github-actions[bot]', 'true'],
    ['NONE', 'Bot', 'unlisted-app[bot]', 'false'],
  ]) {
    assert.equal(
      execFileSync(process.execPath, [script], {
        encoding: 'utf8',
        env: { AUTHOR_ASSOCIATION, AUTHOR_TYPE, AUTHOR_LOGIN },
      }),
      expected,
    );
  }
});
