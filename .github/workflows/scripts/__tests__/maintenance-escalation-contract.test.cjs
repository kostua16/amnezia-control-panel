'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('MNT-E04: maintenance prompt and knowledge contracts share issue exemptions', () => {
  const prompt = read('.github/workflows/maintenance.yml');
  const agent = read('.claude/agents/kos-maintenance.md');
  const skill = read('.claude/skills/kos-daily-maintenance-sweep/SKILL.md');
  for (const source of [prompt, agent, skill]) {
    const text = source.replace(/\s+/g, ' ');
    assert.match(text, /umbrella-sub-issue/);
    assert.match(text, /deferred/);
    assert.match(text, /actively worked or recently triaged but unresolved/);
  }
  assert.match(prompt, /keep-open.*backlog.*in-progress.*umbrella-sub-issue/);
  assert.match(prompt, /\[todo-backlog\].*\[claude-health\].*\[grouped\]/);
  assert.match(prompt, /umbrella tracking issue.*rolling issue/);
});

test('MNT-E05: stale policy exempts backlog sub-issues while catch-up still nudges them', () => {
  const stale = yaml.load(read('.github/workflows/stale.yml'));
  const catchup = read('.github/workflows/issue-catch-up.yml');
  assert.equal(
    stale.jobs.stale.steps.find((step) =>
      step.uses?.startsWith('actions/stale@'),
    ).with['exempt-issue-labels'],
    'keep-open,backlog,in-progress,umbrella-sub-issue',
  );
  assert.match(catchup, /priority_escalation\.push/);
  assert.match(catchup, /Priority issue awaiting attention/);
});

test('APR-E10e: escalation label policy and best-effort setup precede both issue consumers', () => {
  const policy = JSON.parse(read('.github/workflows/policy.json'));
  assert.ok(policy.labels.escalation);
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
  assert.match(steps[ensureIndex].with.names, /maintenance/);
  assert.match(steps[ensureIndex].with.names, /escalation/);
});
