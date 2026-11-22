/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  COMPLETED_SOURCES_FILE,
  collectOpenExecutionPlanSlots,
  runCollector,
  sha256,
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

test('runCollector skips an artifact whose sibling SUMMARY reports completion', () => {
  // Reproduces the 260815-n6m import: the PLAN frontmatter still says "ready",
  // but the sibling SUMMARY records status: complete — importing it queues a
  // no-op execution whose only output is the queue-plan persistence itself.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const dir = path.join(quickDir, '260815-example');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '260815-example-PLAN.md'),
      '---\nstatus: ready\n---\n# Example\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, '260815-example-SUMMARY.md'),
      '---\nstatus: complete\n---\n# Done\n',
      'utf8',
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, false);
    assert.equal(result.skipped[0].reason, 'source-complete');
    assert.equal(
      fs.existsSync(path.join(queueDir, '999-001-PLAN.md')),
      false,
      'completed artifacts must not be queued for execution',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCollector skips an artifact whose own frontmatter reports completion', () => {
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const dir = path.join(quickDir, '260611-example');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'PLAN.md'),
      '---\nstatus: complete\n---\n# Already done\n',
      'utf8',
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, false);
    assert.equal(result.skipped[0].reason, 'source-complete');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCollector falls through to a later non-terminal candidate', () => {
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const doneDir = path.join(quickDir, '260610-done');
    fs.mkdirSync(doneDir, { recursive: true });
    fs.writeFileSync(
      path.join(doneDir, 'PLAN.md'),
      '---\nstatus: complete\n---\n# Done\n',
      'utf8',
    );
    writeCandidate(quickDir, '260611-next', '# Next\n');

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, true);
    assert.match(result.selected[0].path, /260611-next\/proposal\.md$/);
    assert.equal(result.skipped[0].reason, 'source-complete');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rendered plan states the commit policy once, subordinate to workflow automation', () => {
  // The embedded artifact may carry its own commit/PR conventions; the plan
  // must reconcile them instead of issuing contradictory directives.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    writeCandidate(quickDir, '260606-arch-review', '# Arch review\n');

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    const plan = fs.readFileSync(result.selected[0].plan_path, 'utf8');
    assert.match(plan, /Do not commit, push, merge, or open pull requests/);
    assert.match(
      plan,
      /how automation labels those commits, not actions for the executor to take/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test('runCollector imports a deferred proposal whose issue body contains a status: complete line', () => {
  // promote-deferred-proposal.cjs embeds the raw issue body after the heading.
  // There is no frontmatter block, so a body-level `status:` line is content.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    fs.writeFileSync(
      path.join(quickDir, 'deferred-issue-42-plan.md'),
      [
        '# Deferred proposal from issue #42',
        '',
        'Source: deferred-proposal issue #42.',
        '',
        '```yaml',
        'status: complete',
        '```',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, true);
    assert.match(result.selected[0].path, /deferred-issue-42-plan\.md$/);
    assert.equal(result.skipped.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sibling SUMMARY detection is scoped to the artifact whose stem it shares', () => {
  // Two artifacts in one directory: only the stemless PLAN.md owns the plain
  // SUMMARY.md, so its completion must not retire the stemmed plan beside it.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const dir = path.join(quickDir, '260901-shared');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'PLAN.md'),
      '---\nstatus: ready\n---\n# Done one\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'SUMMARY.md'),
      '---\nstatus: complete\n---\n# Done\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, '260901-alpha-PLAN.md'),
      '---\nstatus: ready\n---\n# Alpha\n',
      'utf8',
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 2,
    });

    assert.deepEqual(
      result.selected.map((entry) => path.basename(entry.path)),
      ['260901-alpha-PLAN.md'],
    );
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0].path, /260901-shared\/PLAN\.md$/);
    assert.equal(result.skipped[0].reason, 'source-complete');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a root-level SUMMARY does not retire deferred proposals sharing .planning/quick', () => {
  // promote-deferred-proposal.cjs writes deferred-issue-<n>-plan.md at the
  // quick root, so a directory-wide lookup would suppress every proposal.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    fs.writeFileSync(
      path.join(quickDir, 'deferred-issue-7-plan.md'),
      '# Deferred seven\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(quickDir, 'deferred-issue-9-SUMMARY.md'),
      '---\nstatus: complete\n---\n# Done nine\n',
      'utf8',
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, true);
    assert.match(result.selected[0].path, /deferred-issue-7-plan\.md$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCollector treats an unreadable sibling SUMMARY as non-terminal', () => {
  // A directory named SUMMARY.md makes readFileSync throw EISDIR; intake must
  // keep going rather than fail the whole run.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const dir = path.join(quickDir, '260611-race');
    fs.mkdirSync(path.join(dir, 'SUMMARY.md'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'PLAN.md'),
      '---\nstatus: ready\n---\n# Ready\n',
      'utf8',
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit candidate path overrides the completion gate', () => {
  // candidate_path is only set by workflow_dispatch: a maintainer naming a
  // finished artifact means to re-queue it, unlike the scheduled sweep.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const dir = path.join(quickDir, '260611-example');
    fs.mkdirSync(dir, { recursive: true });
    const artifact = path.join(dir, 'PLAN.md');
    fs.writeFileSync(
      artifact,
      '---\nstatus: complete\n---\n# Already done\n',
      'utf8',
    );

    const scheduled = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: false,
      maxPlans: 1,
    });
    const manual = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: false,
      maxPlans: 1,
      candidatePath: artifact,
    });

    assert.equal(scheduled.has_candidate, false);
    assert.equal(scheduled.skipped[0].reason, 'source-complete');
    assert.equal(manual.has_candidate, true);
    assert.equal(manual.skipped.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCollector does not re-import a source recorded in the completed-sources ledger', () => {
  // A queue plan is deleted once its execution is a no-op; the ledger keeps
  // the hash, path, and slot it carried so the source stays retired.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const dir = path.join(quickDir, '260611-done');
    fs.mkdirSync(dir, { recursive: true });
    const artifact = path.join(dir, 'PLAN.md');
    const content = '---\nstatus: ready\n---\n# Done\n';
    fs.writeFileSync(artifact, content, 'utf8');
    writeCandidate(quickDir, '260612-next', '# Next\n');
    fs.writeFileSync(
      path.join(queueDir, COMPLETED_SOURCES_FILE),
      JSON.stringify([
        {
          plan: '999-116',
          source_artifact: artifact,
          source_artifact_sha256: sha256(content),
        },
      ]),
      'utf8',
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.match(result.selected[0].path, /260612-next\/proposal\.md$/);
    assert.equal(result.skipped[0].reason, 'already-imported-hash');
    assert.equal(result.selected[0].plan, '999-117');

    // An edited artifact no longer matches the hash, but its path stays retired.
    fs.writeFileSync(artifact, `${content}edited\n`, 'utf8');
    const edited = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: false,
      maxPlans: 1,
    });
    assert.equal(edited.skipped[0].reason, 'already-imported-path');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCollector ignores a malformed completed-sources ledger', () => {
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    writeCandidate(quickDir, '260611-next', '# Next\n');
    fs.writeFileSync(
      path.join(queueDir, COMPLETED_SOURCES_FILE),
      '{not json',
      'utf8',
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, true);
    assert.equal(result.selected[0].plan, '999-001');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runCollector keeps an artifact whose sibling SUMMARY is not terminal', () => {
  // In-flight work has no completion record: a SUMMARY still reporting
  // `in-progress` must never retire the artifact beside it, whatever the
  // status detection does with the terminal-status set.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const dir = path.join(quickDir, '260611-wip');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'PLAN.md'),
      '---\nstatus: in-progress\n---\n# WIP\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'PLAN-SUMMARY.md'),
      '---\nstatus: in-progress\n---\n# Partial\n',
      'utf8',
    );

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, true);
    assert.equal(result.skipped.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a stemmed plan falls back to an unowned plain SUMMARY beside it', () => {
  // A rename or generator drift can leave `<stem>-PLAN.md` with its completion
  // record as a plain `SUMMARY.md`. With no stemless plan in the directory to
  // own that summary, it is this plan's record and must retire it; otherwise
  // the completed artifact is re-imported and the no-op persistence loop
  // returns without any warning.
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const dir = path.join(quickDir, '260901-drift');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '260901-drift-PLAN.md'),
      '---\nstatus: ready\n---\n# Drifted\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'SUMMARY.md'),
      '---\nstatus: complete\n---\n# Done\n',
      'utf8',
    );
    writeCandidate(quickDir, '260902-next', '# Next\n');

    const result = runCollector({
      quickDir,
      queueDir,
      openPrsFile: '',
      write: true,
      maxPlans: 1,
    });

    assert.equal(result.has_candidate, true);
    assert.match(result.selected[0].path, /260902-next\/proposal\.md$/);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0].path, /260901-drift-PLAN\.md$/);
    assert.equal(result.skipped[0].reason, 'source-complete');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a completed-sources row with an uppercase hash retires its source without warning', () => {
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    const dir = path.join(quickDir, '260611-done');
    fs.mkdirSync(dir, { recursive: true });
    const artifact = path.join(dir, 'PLAN.md');
    const content = '---\nstatus: ready\n---\n# Done\n';
    fs.writeFileSync(artifact, content, 'utf8');
    writeCandidate(quickDir, '260612-next', '# Next\n');
    fs.writeFileSync(
      path.join(queueDir, COMPLETED_SOURCES_FILE),
      JSON.stringify([
        {
          plan: '999-116',
          source_artifact: artifact,
          // Candidate digests come from sha256() (lowercase); a hand-written
          // uppercase entry must still match after normalisation.
          source_artifact_sha256: sha256(content).toUpperCase(),
        },
      ]),
      'utf8',
    );

    const warnings = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = (chunk) => {
      warnings.push(String(chunk));
      return true;
    };
    let result;
    try {
      result = runCollector({
        quickDir,
        queueDir,
        openPrsFile: '',
        write: false,
        maxPlans: 1,
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.match(result.selected[0].path, /260612-next\/proposal\.md$/);
    assert.equal(result.skipped[0].reason, 'already-imported-hash');
    assert.equal(
      warnings.join('').includes('::warning'),
      false,
      'a well-formed row must not warn',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a malformed completed-sources row warns and leaves its slot reusable', () => {
  const { quickDir, queueDir, root } = makeSandbox();
  try {
    writeCandidate(quickDir, '260611-next', '# Next\n');
    fs.writeFileSync(
      path.join(queueDir, COMPLETED_SOURCES_FILE),
      JSON.stringify([{ plan: '116', source_artifact_sha256: 'not-a-hash' }]),
      'utf8',
    );

    const warnings = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = (chunk) => {
      warnings.push(String(chunk));
      return true;
    };
    let result;
    try {
      result = runCollector({
        quickDir,
        queueDir,
        openPrsFile: '',
        write: true,
        maxPlans: 1,
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.equal(result.has_candidate, true);
    // The unparseable slot must not consume 999-116: numbering starts at 001.
    assert.equal(result.selected[0].plan, '999-001');
    const emitted = warnings.join('');
    assert.match(emitted, /::warning title=completed-sources\.json/);
    assert.match(emitted, /is not a 999-<n> slot/);
    assert.match(emitted, /is not a hex digest/);
    assert.match(emitted, /source_artifact is missing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
