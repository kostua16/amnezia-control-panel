const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('run-zai forwards settings isolation to every Claude attempt', (t) => {
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
  assert.equal(
    wrapper.with['allowed-tools'],
    '${{ inputs.allowed-tools }},Agent,TaskCreate,TaskUpdate,TaskGet,TaskList',
  );
  for (const attempt of attempts) {
    assert.match(attempt.with.claude_args, /--setting-sources user --settings/);
    assert.match(
      attempt.with.claude_args,
      /steps\.isolated-settings\.outputs\.path/,
    );
  }

  const prepare = params.runs.steps.find(
    (step) => step.id === 'isolated-settings',
  );
  assert.ok(prepare, 'Missing isolated-settings step in run-claude-params');
  const heredoc = prepare.run?.match(/<<'NODE'\n([\s\S]+?)\nNODE$/m);
  assert.ok(heredoc, 'Expected a NODE heredoc in the isolated-settings step');
  const [, generator] = heredoc;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-guards-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const settingsFile = path.join(directory, 'settings.json');
  execFileSync(process.execPath, ['-', settingsFile], {
    cwd: path.resolve(__dirname, '../../../..'),
    input: generator,
  });
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.deepEqual(Object.keys(settings), ['hooks']);
  const pre = settings.hooks.PreToolUse.flatMap((group) => group.hooks);
  const post = settings.hooks.PostToolUse.flatMap((group) => group.hooks);
  assert.equal(pre.length, 1);
  assert.equal(post.length, 1);
  assert.match(pre[0].command, /privacy-block\.cjs/);
  assert.match(post[0].command, /gsd-read-injection-scanner\.js/);

  assert.equal(post[0].timeout, 5);

  const configDir = path.join(directory, '.claude');
  fs.mkdirSync(configDir);
  for (const config of [
    {},
    { hooks: {} },
    { hooks: { PreToolUse: [{}] } },
    { hooks: { PreToolUse: {} } },
    { hooks: { PreToolUse: [null] } },
    {
      hooks: {
        PreToolUse: [
          { matcher: settings.hooks.PreToolUse[0].matcher, hooks: {} },
        ],
      },
    },
    {
      hooks: {
        ...settings.hooks,
        PreToolUse: [
          {
            matcher: settings.hooks.PreToolUse[0].matcher,
            hooks: [{ type: 'command', command: 'true # /privacy-block.cjs' }],
          },
        ],
      },
    },
  ]) {
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify(config),
    );
    const result = spawnSync(process.execPath, ['-', settingsFile], {
      cwd: directory,
      input: generator,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Error: Missing Claude guard: privacy-block\.cjs/,
    );
  }
});
