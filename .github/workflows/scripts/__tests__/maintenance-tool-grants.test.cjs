const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('maintenance pins the scoped tool grants and prompt commands', () => {
  const { load } = require('js-yaml');
  const workflow = load(
    fs.readFileSync(path.join(__dirname, '../../maintenance.yml'), 'utf8'),
  );
  const steps = workflow.jobs.maintenance.steps;
  const agent = steps.find((step) => step.id === 'claude_run');
  assert.equal(agent.with['user-settings-only'], 'true');
  const cutoff = steps.find((step) => step.id === 'stale_issue_cutoff');
  assert.ok(cutoff && steps.indexOf(cutoff) < steps.indexOf(agent));
  assert.match(cutoff.run, /date -u -d '90 days ago'/);
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
