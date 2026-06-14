/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  collectOpenExecutionPlanSlots,
  runCollector,
} = require('../collect-gsd-planning-intake.cjs');

function openPrBody(slot) {
  const plan = `999-${String(slot).padStart(3, '0')}`;
  return [
    'GSD planning executor imported and executed a merged planning artifact.',
    `Imported plan: \`.planning/phases/999-gh-planning-execution-queue/${plan}-PLAN.md\``,
    '<!-- gsd-planning-source-sha256: deadbeef -->',
  ].join('\n');
}

function writeOpenPrsFile(file, rows) {
  fs.writeFileSync(file, JSON.stringify(rows), 'utf8');
}

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-intake-'));
  const quickDir = path.join(root, 'quick');
  const queueDir = path.join(root, 'queue');
  fs.mkdirSync(quickDir, { recursive: true });
  fs.mkdirSync(queueDir, { recursive: true });
  return { root, quickDir, queueDir };
}

function seedQueuePlan(queueDir, number) {
  // Minimal plan file: the basename carries the slot number collectImportedSources reads.
  const id = `999-${String(number).padStart(3, '0')}`;
  fs.writeFileSync(
    path.join(queueDir, `${id}-PLAN.md`),
    `# Plan ${id}\n`,
    'utf8',
  );
}

function writeCandidate(quickDir, slug, content) {
  const dir = path.join(quickDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposal.md'), content, 'utf8');
}

test('collectOpenExecutionPlanSlots reserves only the slot named by the Imported plan marker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-slots-'));
  try {
    const file = path.join(root, 'open-prs.json');
    writeOpenPrsFile(file, [
      { number: 365, body: openPrBody(3) },
      {
        number: 372,
        body: 'Narrative that merely mentions 999-002-PLAN.md without the marker.',
      },
    ]);

    const slots = collectOpenExecutionPlanSlots(file);

    assert.equal(slots.size, 1);
    assert.equal(slots.has(3), true);
    assert.equal(slots.has(2), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collectOpenExecutionPlanSlots is a no-op without an open-prs file', () => {
  assert.equal(collectOpenExecutionPlanSlots('').size, 0);
  assert.equal(collectOpenExecutionPlanSlots('/does/not/exist.json').size, 0);
});

test('runCollector uses the next low slot when no open PR reserves it (control)', () => {
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    seedQueuePlan(queueDir, 1);
    seedQueuePlan(queueDir, 2);
    writeCandidate(quickDir, '260606-arch-review', '# Arch review\n');

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, true);
    assert.equal(result.selected[0].plan, '999-003');
    assert.equal(fs.existsSync(path.join(queueDir, '999-003-PLAN.md')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCollector skips a slot reserved by an open execution PR', () => {
  // Reproduces PR #365 vs #372: both target slot 003 from a main checkout that
  // only knows about 001/002, with different source hashes so hash dedup passes.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    seedQueuePlan(queueDir, 1);
    seedQueuePlan(queueDir, 2);
    writeCandidate(quickDir, '260606-arch-review', '# Arch review\n');
    const openPrs = path.join(root, 'open-prs.json');
    writeOpenPrsFile(openPrs, [{ number: 365, body: openPrBody(3) }]);

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: openPrs,
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, true);
    assert.equal(result.selected[0].plan, '999-004');
    assert.match(result.selected[0].plan_path, /999-004-PLAN\.md$/);
    assert.equal(
      fs.existsSync(path.join(queueDir, '999-003-PLAN.md')),
      false,
      'reserved slot 003 must not be overwritten',
    );
    assert.equal(fs.existsSync(path.join(queueDir, '999-004-PLAN.md')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCollector hands out sequential free slots when one is reserved', () => {
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    seedQueuePlan(queueDir, 1);
    seedQueuePlan(queueDir, 2);
    writeCandidate(quickDir, '260606-arch-review', '# Arch review\n');
    writeCandidate(quickDir, '260610-perf', '# Perf\n');
    const openPrs = path.join(root, 'open-prs.json');
    writeOpenPrsFile(openPrs, [{ number: 365, body: openPrBody(3) }]);

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: openPrs,
      write: true,
      maxPlans: 2,
    });

    assert.deepEqual(
      result.selected.map((entry) => entry.plan),
      ['999-004', '999-005'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collectOpenExecutionPlanSlots trusts the changed-files list over a stale body marker', () => {
  // Reproduces the #375/#372 marker drift: the "Imported plan" body marker says
  // 003, but the PR actually occupies a higher slot. The files list must win, or
  // the next scheduled run re-assigns the real slot and collides on the plan
  // file and overlapping source changes.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-slots-'));
  try {
    const file = path.join(root, 'open-prs.json');
    writeOpenPrsFile(file, [
      {
        number: 375,
        body: openPrBody(3),
        files: [
          {
            path: '.planning/phases/999-gh-planning-execution-queue/999-005-PLAN.md',
          },
        ],
      },
    ]);

    const slots = collectOpenExecutionPlanSlots(file);

    assert.equal(slots.has(5), true);
    assert.equal(
      slots.has(3),
      false,
      'stale marker must not leak into the reserved set when files are present',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCollector reserves the real slot a stale-marker open PR occupies', () => {
  // main checkout knows 001/002 only; open PRs occupy 003/004/005 but #372 and
  // #375 carry a stale body marker that says 003. Without files-based
  // reservation the next run would re-assign 005 and collide with #375.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    seedQueuePlan(queueDir, 1);
    seedQueuePlan(queueDir, 2);
    writeCandidate(quickDir, '260610-next', '# Next\n');
    const openPrs = path.join(root, 'open-prs.json');
    writeOpenPrsFile(openPrs, [
      { number: 365, body: openPrBody(3) },
      {
        number: 372,
        body: openPrBody(3),
        files: [
          {
            path: '.planning/phases/999-gh-planning-execution-queue/999-004-PLAN.md',
          },
        ],
      },
      {
        number: 375,
        body: openPrBody(3),
        files: [
          {
            path: '.planning/phases/999-gh-planning-execution-queue/999-005-PLAN.md',
          },
        ],
      },
    ]);

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: openPrs,
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.selected[0].plan, '999-006');
    assert.match(result.selected[0].plan_path, /999-006-PLAN\.md$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
