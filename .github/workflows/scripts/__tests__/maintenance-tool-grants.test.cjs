const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { load } = require('js-yaml');
const { evaluateExpression } = require('./helpers/github-expression.cjs');

const workflow = load(
  fs.readFileSync(path.join(__dirname, '../../maintenance.yml'), 'utf8'),
);
const steps = workflow.jobs.maintenance.steps;
const agent = steps.find((step) => step.id === 'claude_run');
const cutoff = steps.find((step) => step.id === 'stale_issue_cutoff');

test('maintenance pins the scoped tool grants and prompt commands', () => {
  assert.equal(agent.with['user-settings-only'], 'true');
  assert.ok(cutoff && steps.indexOf(cutoff) < steps.indexOf(agent));
  assert.equal(cutoff.if, undefined);
  assert.match(cutoff.run, /date -u -d '90 days ago'/);
  assert.match(
    cutoff.run,
    /^\s*printf 'utc=%s\\n' "\$cutoff" >> "\$GITHUB_OUTPUT"$/m,
  );
  // Pin the workflow allowlist and check that the TOOL GRANTS line describes
  // the allowed commands. The unattended sweep reads public issue and PR
  // content. Pin the planning health query, npm audit, and git log exactly:
  // --repair/--backfill can change .planning/, npm audit fix can rewrite the
  // lockfile, and git log --output=<file> can write a file. The maintenance
  // persist step stages working-tree changes with git add -A. GitHub CLI
  // grants allow arguments for the listed subcommands, and df accepts flags.
  const gsdToolsHealth =
    'node .claude/gsd-core/bin/gsd-tools.cjs query validate.health';
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
    'gh issue list --state open --search "created:<${{ steps.stale_issue_cutoff.outputs.utc }} sort:updated-desc" --limit 100',
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

const bashAvailable = spawnSync('bash', ['-c', 'true']).status === 0;

test(
  'maintenance rejects malformed cutoffs and renders a dated issue search',
  { skip: !bashAvailable },
  (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'maintenance-cutoff-'),
    );
    const output = path.join(directory, 'output');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const runBash = (script, env = {}) =>
      spawnSync(
        'bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script],
        {
          env: { ...process.env, GITHUB_OUTPUT: output, ...env },
          encoding: 'utf8',
        },
      );
    const script =
      'date() { printf "%s" "$MAINTENANCE_TEST_DATE"; }\n' + cutoff.run;
    for (const malformed of ['', '2026-08-28T17:00:00', 'invalid']) {
      const result = runBash(script, { MAINTENANCE_TEST_DATE: malformed });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stdout, /Invalid stale issue UTC cutoff/);
      assert.equal(fs.existsSync(output), false);
    }

    const utc = '2026-08-28T17:00:00Z';
    const result = runBash(script, { MAINTENANCE_TEST_DATE: utc });
    assert.equal(result.status, 0, result.stderr);
    const outputs = Object.fromEntries([
      fs.readFileSync(output, 'utf8').trim().split('='),
    ]);
    assert.deepEqual(outputs, { utc });
    const [, search] =
      /\x60(gh issue list --state open --search [^\x60]+)\x60/.exec(
        agent.with.prompt,
      );
    const rendered = search.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) =>
      evaluateExpression(expression, { steps: { [cutoff.id]: { outputs } } }),
    );
    const query = runBash('gh() { printf "%s\\n" "$@"; }\n' + rendered);
    assert.equal(query.status, 0, query.stderr);
    assert.deepEqual(query.stdout.trim().split(/\r?\n/), [
      'issue',
      'list',
      '--state',
      'open',
      '--search',
      'created:<' + utc + ' sort:updated-desc',
      '--limit',
      '100',
    ]);
  },
);
