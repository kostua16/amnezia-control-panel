const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pruneStaleDebugDocs } = require('../prune-stale-debug-docs.cjs');

test('prunes only top-level resolved docs strictly older than 30 days', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-debug-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const documents = {
    'old.md':
      "---\r\nstatus: 'resolved'\r\nupdated: 2026-05-01T23:59:59Z\r\n---\r\n",
    'old-offset.md':
      '---\nstatus: resolved\nupdated: 2026-05-02T01:59:59+02:00\n---\n',
    'boundary.md': '---\nstatus: resolved\nupdated: 2026-05-02\n---\n',
    'fresh.md': '---\nstatus: resolved\nupdated: 2026-05-03\n---\n',
    'fixed.md': '---\nstatus: fixed\nupdated: 2026-04-01\n---\n',
    'invalid.md': '---\nstatus: resolved\nupdated: invalid\n---\n',
    'ambiguous.md': '---\nstatus: resolved\nupdated: 01/06/2026\n---\n',
    'impossible.md': '---\nstatus: resolved\nupdated: 2026-02-30\n---\n',
    'missing.md': '---\nstatus: resolved\n---\n',
    'body.md': 'Debug notes\n---\nstatus: resolved\nupdated: 2026-04-01\n---\n',
  };
  for (const [filename, content] of Object.entries(documents)) {
    fs.writeFileSync(path.join(directory, filename), content);
  }
  fs.mkdirSync(path.join(directory, 'resolved'));
  fs.writeFileSync(
    path.join(directory, 'resolved', 'old.md'),
    documents['old.md'],
  );

  pruneStaleDebugDocs(directory, Date.parse('2026-06-01T00:00:00Z'));

  assert.deepEqual(
    fs.readdirSync(directory).sort(),
    [
      ...Object.keys(documents).filter(
        (filename) => !['old.md', 'old-offset.md'].includes(filename),
      ),
      'resolved',
    ].sort(),
  );
  assert.ok(fs.existsSync(path.join(directory, 'resolved', 'old.md')));
  pruneStaleDebugDocs(path.join(directory, 'missing-directory'));
});

test('maintenance runs pruning before change detection and keeps writes out of the allowlist', () => {
  const { load } = require('js-yaml');
  const workflow = load(
    fs.readFileSync(path.join(__dirname, '../../maintenance.yml'), 'utf8'),
  );
  const steps = workflow.jobs.maintenance.steps;
  const prune = steps.findIndex(
    (step) =>
      step.run === 'node .github/workflows/scripts/prune-stale-debug-docs.cjs',
  );
  assert.ok(
    prune >
      steps.findIndex(
        (step) => step.name === 'Fail workflow on Claude failure',
      ),
  );
  assert.equal(steps[prune + 1].id, 'detect_changes');
  const agent = steps.find((step) => step.id === 'claude_run');
  assert.equal(agent.with['user-settings-only'], 'true');
  const approved = new Set([
    'gh issue create',
    'gh issue list',
    'gh issue view',
    'gh pr comment',
    'gh pr list',
    'gh pr view',
    'npm audit',
    'git log',
  ]);
  for (const grant of agent.with['allowed-tools'].split(',')) {
    if (
      [
        'Read',
        'Glob',
        'Grep',
        'Bash(node .claude/get-shit-done/bin/gsd-tools.cjs query validate.health)',
      ].includes(grant)
    )
      continue;
    const command = grant.match(/^Bash\((?:rtk )?(.+):\*\)$/)?.[1];
    assert.ok(approved.has(command), `Unexpected maintenance grant: ${grant}`);
  }
  assert.match(agent.with['allowed-tools'], /Bash\(gh pr comment:/);
});

test('run-zai forwards settings isolation to every Claude attempt', () => {
  const { load } = require('js-yaml');
  const readAction = (name) =>
    load(
      fs.readFileSync(
        path.join(__dirname, '../../../actions', name, 'action.yml'),
        'utf8',
      ),
    );
  const zai = readAction('run-zai');
  const params = readAction('run-claude-params');
  assert.equal(zai.inputs['user-settings-only'].default, 'false');
  assert.equal(params.inputs['user-settings-only'].default, 'false');
  const wrapper = zai.runs.steps.find(
    (step) => step.uses === './.github/actions/run-claude-params',
  );
  assert.equal(
    wrapper.with['user-settings-only'],
    '${{ inputs.user-settings-only }}',
  );
  const attempts = params.runs.steps.filter((step) =>
    step.uses?.startsWith('anthropics/claude-code-action@'),
  );
  assert.equal(attempts.length, 3);
  for (const attempt of attempts) {
    assert.ok(
      attempt.with.claude_args.includes(
        "\${{ inputs.user-settings-only == 'true' && '--setting-sources user' || '' }}",
      ),
    );
  }
});
