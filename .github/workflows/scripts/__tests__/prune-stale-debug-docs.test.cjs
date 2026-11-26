const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
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

test('maintenance runs pruning before change detection and pins the scoped tool grants', () => {
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
  // Pin the workflow allowlist and check that the TOOL GRANTS line describes
  // the allowed commands. The unattended sweep reads public issue and PR
  // content. Pin the planning health query, npm audit, and git log exactly:
  // --repair/--backfill can change .planning/, npm audit fix can rewrite the
  // lockfile, and git log --output=<file> can write a file. The maintenance
  // persist step stages working-tree changes with git add -A. GitHub CLI
  // grants allow arguments for the listed subcommands, and df accepts flags.
  const gsdToolsHealth =
    'node .claude/get-shit-done/bin/gsd-tools.cjs query validate.health';
  const gitLogSweep = String.raw`git log --since="12 hours ago" --grep="TODO\|FIXME" --oneline`;
  const grants = [
    { command: gsdToolsHealth, exact: true, rtk: true },
    { command: 'gh issue create', exact: false, rtk: true },
    { command: 'gh issue list', exact: false, rtk: true },
    { command: 'gh issue view', exact: false, rtk: true },
    { command: 'gh pr comment', exact: false, rtk: true },
    { command: 'gh pr list', exact: false, rtk: true },
    { command: 'gh pr view', exact: false, rtk: true },
    { command: 'npm audit --json', exact: true, rtk: true },
    { command: gitLogSweep, exact: true, rtk: true },
    { command: 'df', exact: false, rtk: false },
  ];
  const expected = [
    'Read',
    'Glob',
    'Grep',
    ...grants.flatMap(({ command, exact, rtk }) => {
      const spec = `${command}${exact ? '' : ':*'}`;
      return rtk ? [`Bash(${spec})`, `Bash(rtk ${spec})`] : [`Bash(${spec})`];
    }),
  ];
  assert.deepEqual(
    agent.with['allowed-tools'].split(',').sort(),
    expected.sort(),
  );

  const prompt = agent.with.prompt;
  const toolGrants = prompt
    .split('\n')
    .find((line) => line.trim().startsWith('TOOL GRANTS:'));
  assert.ok(
    toolGrants,
    'maintenance prompt must document its TOOL GRANTS line',
  );
  for (const { command } of grants) {
    assert.ok(
      toolGrants.includes(`\`${command}\``),
      `TOOL GRANTS line must document \`${command}\``,
    );
  }
  for (const forbidden of [
    'node -e',
    '`echo`',
    '`cat`',
    '`head`',
    '`tail`',
    '`wc`',
    'node:*',
    'gh issue:*',
    'gh pr:*',
    'npm audit:*',
    'validate.health:*',
    'git log:*',
    '`git log`',
  ]) {
    assert.ok(
      !toolGrants.includes(forbidden),
      `TOOL GRANTS line must not mention ${forbidden}`,
    );
  }

  // Pin every single-line backticked span in the workflow prompt that
  // begins with a lowercase command word followed by arguments, and check
  // each captured span against the Bash grants. Commands written in other
  // forms or in the maintenance agent contract or skills need separate review.
  const bashGrants = agent.with['allowed-tools']
    .split(',')
    .filter((tool) => tool.startsWith('Bash('))
    .map((tool) => tool.slice(5, -1));
  const covers = (command) =>
    bashGrants.some((grant) =>
      grant.endsWith(':*')
        ? command === grant.slice(0, -2) ||
          command.startsWith(`${grant.slice(0, -2)} `)
        : command === grant,
    );
  const promptCommands = [
    ...prompt.matchAll(/`([a-z][a-z0-9-]*(?: [^`\n]+)+)`/g),
  ].map((match) => match[1]);
  assert.deepEqual(promptCommands, [
    gsdToolsHealth,
    'npm audit --json',
    gitLogSweep,
    'gh issue list --state open --search "created:<CUTOFF"',
    'gh issue create --title "Security: [summary of vulnerabilities]" --label "security" --body "[detailed findings]"',
    'gh issue create --title "Maintenance: stale issues review" --label "maintenance" --body "[list of stale issues]"',
    'gh issue create --title "Maintenance: unresolved TODOs" --label "maintenance" --body "[list of TODOs with commit references]"',
    gsdToolsHealth,
    'gh issue create',
    'gh issue list',
    'gh issue view',
    'gh pr comment',
    'gh pr list',
    'gh pr view',
    'npm audit --json',
    gitLogSweep,
  ]);
  for (const command of promptCommands) {
    assert.ok(
      covers(command),
      `maintenance prompt command \`${command}\` is not granted in allowed-tools`,
    );
  }
});

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
