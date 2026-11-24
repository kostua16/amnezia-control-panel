'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('MNT-I08a: maintenance prompt and knowledge contracts share issue exemptions', () => {
  const prompt = read('.github/workflows/maintenance.yml');
  const agent = read('.claude/agents/kos-maintenance.md');
  const skill = read('.claude/skills/kos-daily-maintenance-sweep/SKILL.md');
  for (const source of [prompt, agent, skill]) {
    const text = source.replace(/\s+/g, ' ');
    for (const exemptLabel of [
      'stale',
      'keep-open',
      'backlog',
      'in-progress',
      'umbrella-sub-issue',
    ]) {
      assert.ok(text.includes(`\`${exemptLabel}\``));
    }
    assert.match(text, /`deferred` (?:is )?(?:NOT exempt|eligible)/i);
    assert.match(text, /actively worked or recently triaged but unresolved/);
  }
  assert.match(prompt, /keep-open.*backlog.*in-progress.*umbrella-sub-issue/);
  assert.match(prompt, /\[todo-backlog\].*\[claude-health\].*\[grouped\]/);
  assert.match(prompt, /umbrella tracking issue.*rolling issue/);
});

test('MNT-I08b: stale policy exempts backlog sub-issues while catch-up still nudges them', () => {
  const stale = yaml.load(read('.github/workflows/stale.yml'));
  const catchup = read('.github/workflows/issue-catch-up.yml');
  assert.equal(
    stale.jobs.stale.steps.find((step) =>
      step.uses?.startsWith('actions/stale@'),
    ).with['exempt-issue-labels'],
    'keep-open,backlog,in-progress,umbrella-sub-issue',
  );
  const catchupExemptLabels = catchup.match(
    /const EXEMPT_LABELS = \[([^\]]*)\]/,
  );
  assert.ok(catchupExemptLabels);
  assert.doesNotMatch(catchupExemptLabels[1], /umbrella-sub-issue/);
  assert.match(catchup, /priority_escalation\.push/);
  assert.match(catchup, /Priority issue awaiting attention/);
});

test('APR-E10f: best-effort label setup precedes both issue consumers', () => {
  const policy = JSON.parse(read('.github/workflows/policy.json'));
  const workflow = yaml.load(read('.github/workflows/audit-auto-prs.yml'));
  const steps = workflow.jobs['publish-digest'].steps;
  const ensureIndex = steps.findIndex(
    (step) => step.name === 'Ensure labels exist',
  );
  const digestIndex = steps.findIndex(
    (step) => step.name === 'Publish digest issue',
  );
  const escalationIndex = steps.findIndex((step) =>
    step.name?.includes('Escalate repeated systemic fixes'),
  );
  assert.ok(
    ensureIndex >= 0 &&
      ensureIndex < digestIndex &&
      ensureIndex < escalationIndex,
  );
  assert.equal(steps[ensureIndex]['continue-on-error'], true);
  const labels = steps[ensureIndex].with.names.split(',');
  assert.deepEqual(labels, ['auto-fix', 'needs-review', 'escalation']);
  for (const label of labels) assert.ok(policy.labels[label]);
});
