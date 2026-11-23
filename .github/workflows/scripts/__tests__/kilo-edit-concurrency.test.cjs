/* eslint-disable @typescript-eslint/no-require-imports */
// Concurrency semantics of Kilo sticky-comment edits. GitHub applies a
// workflow's concurrency group at run creation, before any job `if:` runs, and
// keeps one running + one pending run per group (a newer pending run replaces
// the older one; cancel-in-progress also cancels the running one). These tests
// resolve the real `concurrency` expressions of pr-flow.yml and
// auto-cover-review.yml against event payloads and replay interleavings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const {
  renderTemplate,
  truthy,
  evaluateExpression,
} = require('./helpers/github-expression.cjs');

const workflowsDir = path.resolve(__dirname, '..', '..');

function concurrencyOf(file) {
  const workflow = yaml.load(
    fs.readFileSync(path.join(workflowsDir, file), 'utf8'),
  );
  return workflow.concurrency;
}

const PR = 1181;
const KILO = { login: 'kilo-code-bot[bot]', type: 'Bot' };
const STICKY = '<!-- kilo-review -->\n**Status:** 2 Issues Found';

const events = {
  kiloEdit: {
    event_name: 'issue_comment',
    event: {
      action: 'edited',
      issue: { number: PR, pull_request: {} },
      comment: { user: KILO, body: STICKY },
    },
  },
  kiloCreated: {
    event_name: 'issue_comment',
    event: {
      action: 'created',
      issue: { number: PR, pull_request: {} },
      comment: { user: KILO, body: STICKY },
    },
  },
  humanComment: {
    event_name: 'issue_comment',
    event: {
      action: 'created',
      issue: { number: PR, pull_request: {} },
      comment: { user: { login: 'octocat' }, body: 'thanks' },
    },
  },
  botComment: {
    event_name: 'issue_comment',
    event: {
      action: 'created',
      issue: { number: PR, pull_request: {} },
      comment: { user: { login: 'github-actions[bot]' }, body: 'report' },
    },
  },
  ciCompleted: {
    event_name: 'workflow_run',
    event: {
      action: 'completed',
      workflow_run: { pull_requests: [{ number: PR }], display_title: 'CI' },
    },
  },
  codeReviewCompleted: {
    event_name: 'workflow_run',
    event: {
      action: 'completed',
      workflow_run: {
        pull_requests: [{ number: PR }],
        display_title: `PR #${PR}`,
      },
    },
  },
  prtSync: {
    event_name: 'pull_request_target',
    event: { action: 'synchronize', pull_request: { number: PR } },
  },
};

function admission(file, name, vars = {}) {
  const { group, 'cancel-in-progress': cancel } = concurrencyOf(file);
  const spec = events[name];
  const context = {
    github: { event_name: spec.event_name, event: spec.event, run_id: 42 },
    vars,
  };
  return {
    name,
    group: renderTemplate(group, context).trim(),
    cancel: truthy(
      typeof cancel === 'string'
        ? renderTemplate(cancel, context) === 'true'
        : cancel,
    ),
  };
}

// GitHub's per-group queue: one running and at most one pending run.
function replay(arrivals) {
  const groups = new Map();
  const lost = [];
  for (const run of arrivals) {
    const slot = groups.get(run.group) ?? { running: null, pending: null };
    if (run.cancel) {
      if (slot.running) lost.push(slot.running.name);
      if (slot.pending) lost.push(slot.pending.name);
      slot.running = run;
      slot.pending = null;
    } else if (!slot.running) {
      slot.running = run;
    } else {
      if (slot.pending) lost.push(slot.pending.name);
      slot.pending = run;
    }
    groups.set(run.group, slot);
  }
  return { groups, lost };
}

test('the expression helper follows GitHub && / || / format semantics', () => {
  const ctx = { github: { event: { issue: { number: 7 } } }, vars: {} };
  assert.equal(evaluateExpression("vars.X != 'off' && 'a' || 'b'", ctx), 'a');
  assert.equal(evaluateExpression("vars.X == 'off' && 'a' || 'b'", ctx), 'b');
  assert.equal(
    evaluateExpression("format('n-{0}', github.event.issue.number)", ctx),
    'n-7',
  );
  assert.equal(evaluateExpression("'KILO' == 'kilo'", ctx), true);
});

test('pr-flow: Kilo edits get their own group ahead of the wake fallback', () => {
  const { group } = concurrencyOf('pr-flow.yml');
  const kiloedit = group.indexOf("'kiloedit'");
  const wake = group.indexOf("'wake'");
  assert.ok(kiloedit > 0 && kiloedit < wake, 'kiloedit branch precedes wake');

  assert.equal(
    admission('pr-flow.yml', 'kiloEdit').group,
    `pr-flow-kiloedit-${PR}`,
  );
  assert.equal(admission('pr-flow.yml', 'kiloEdit').cancel, false);
  assert.equal(
    admission('pr-flow.yml', 'kiloCreated').group,
    `pr-flow-wake-${PR}`,
  );
  assert.equal(
    admission('pr-flow.yml', 'ciCompleted').group,
    `pr-flow-wake-${PR}`,
  );
  assert.equal(
    admission('pr-flow.yml', 'botComment').group,
    `pr-flow-noise-${PR}`,
  );
  assert.equal(admission('pr-flow.yml', 'prtSync').group, `pr-flow-prt-${PR}`);
  // Rollback: Kilo edits share the wake group again.
  assert.equal(
    admission('pr-flow.yml', 'kiloEdit', { KILO_EDIT_FILTER: 'off' }).group,
    `pr-flow-wake-${PR}`,
  );
});

test('pr-flow: a dropped history-only edit cannot displace a pending CI wake', () => {
  const wake0 = {
    ...admission('pr-flow.yml', 'ciCompleted'),
    name: 'W0 PR Policy wake',
  };
  const relevantEdit = {
    ...admission('pr-flow.yml', 'kiloEdit'),
    name: 'A relevant Kilo edit',
  };
  const ciWake = {
    ...admission('pr-flow.yml', 'ciCompleted'),
    name: 'B CI completion wake',
  };
  const historyEdit = {
    ...admission('pr-flow.yml', 'kiloEdit'),
    name: 'C history-only edit',
  };
  const { groups, lost } = replay([wake0, relevantEdit, ciWake, historyEdit]);

  assert.deepEqual(lost, []);
  assert.equal(
    groups.get(`pr-flow-wake-${PR}`).pending.name,
    'B CI completion wake',
  );
  assert.equal(
    groups.get(`pr-flow-kiloedit-${PR}`).running.name,
    'A relevant Kilo edit',
  );
  assert.equal(
    groups.get(`pr-flow-kiloedit-${PR}`).pending.name,
    'C history-only edit',
  );

  // Same interleaving with the filter off (previous layout): C replaces B.
  const off = { KILO_EDIT_FILTER: 'off' };
  const legacy = replay([
    { ...admission('pr-flow.yml', 'ciCompleted', off), name: 'W0' },
    { ...admission('pr-flow.yml', 'ciCompleted', off), name: 'B' },
    { ...admission('pr-flow.yml', 'kiloEdit', off), name: 'C' },
  ]);
  assert.deepEqual(legacy.lost, ['B']);
});

test('pr-flow: residual race — a relevant edit pending behind an in-flight edit can be replaced', () => {
  // Documented in docs/workflow-e2e-scenarios.md: the next review's first edit
  // arrives while the previous review's second edit is still running.
  const { lost } = replay([
    {
      ...admission('pr-flow.yml', 'kiloEdit'),
      name: 'previous history-only edit (running)',
    },
    {
      ...admission('pr-flow.yml', 'kiloEdit'),
      name: 'relevant edit (pending)',
    },
    { ...admission('pr-flow.yml', 'kiloEdit'), name: 'history-only edit' },
  ]);
  assert.deepEqual(lost, ['relevant edit (pending)']);
});

test('auto-cover-review: admission per event', () => {
  const file = 'auto-cover-review.yml';
  const expect = {
    kiloEdit: [`auto-cover-review-kiloedit-${PR}`, false],
    kiloCreated: [`auto-cover-review-${PR}`, true],
    codeReviewCompleted: [`auto-cover-review-${PR}`, true],
    humanComment: [`auto-cover-review-noise-${PR}`, false],
    botComment: [`auto-cover-review-noise-${PR}`, false],
  };
  for (const [name, [group, cancel]] of Object.entries(expect)) {
    const got = admission(file, name);
    assert.equal(got.group, group, name);
    assert.equal(got.cancel, cancel, name);
  }
  // Rollback restores the previous grouping and cancellation.
  const off = { KILO_EDIT_FILTER: 'off' };
  assert.deepEqual(
    [
      admission(file, 'kiloEdit', off).group,
      admission(file, 'kiloEdit', off).cancel,
    ],
    [`auto-cover-review-${PR}`, true],
  );
  assert.deepEqual(
    [
      admission(file, 'humanComment', off).group,
      admission(file, 'humanComment', off).cancel,
    ],
    [`auto-cover-review-${PR}`, true],
  );
  assert.deepEqual(
    [
      admission(file, 'botComment', off).group,
      admission(file, 'botComment', off).cancel,
    ],
    [`auto-cover-review-noise-${PR}`, false],
  );
});

test('auto-cover-review: edits and unrelated comments never cancel a Code Review wake', () => {
  const file = 'auto-cover-review.yml';
  const { lost, groups } = replay([
    { ...admission(file, 'codeReviewCompleted'), name: 'R code review wake' },
    { ...admission(file, 'kiloEdit'), name: 'A relevant edit' },
    { ...admission(file, 'kiloEdit'), name: 'C history-only edit' },
    { ...admission(file, 'humanComment'), name: 'H human comment' },
  ]);
  assert.deepEqual(lost, []);
  assert.equal(
    groups.get(`auto-cover-review-${PR}`).running.name,
    'R code review wake',
  );

  const off = { KILO_EDIT_FILTER: 'off' };
  const legacy = replay([
    { ...admission(file, 'codeReviewCompleted', off), name: 'R' },
    { ...admission(file, 'kiloEdit', off), name: 'C' },
  ]);
  assert.deepEqual(legacy.lost, ['R']);
});
