import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  SHARED_PLANNING_PATHS,
  repairPlanningIntake,
  rewritePlanningText,
  validatePlanningPr,
} = require('../../../.github/workflows/scripts/repair-planning-intake.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repair-planning-intake-test-'));
}

function makePlanningPr(overrides: Record<string, unknown> = {}) {
  return {
    number: 190,
    title: 'planning: workflow improvement follow-ups for PR #185',
    url: 'https://github.com/kostua16/amnezia-control-panel/pull/190',
    state: 'OPEN',
    isDraft: true,
    headRefName: 'claude-planning-pr-185',
    baseRefName: 'main',
    isCrossRepository: false,
    body: [
      '## Claude+GSD Planning Intake',
      '',
      'Source PR: #185 (https://github.com/kostua16/amnezia-control-panel/pull/185)',
      '',
      'Quick artifact: `.planning/quick/260603-pr185-workflow-improve/260603-pr185-PLAN.md`',
      '',
      '13.x mapping: 13.1 x1, 13.4 x1',
    ].join('\n'),
    files: [
      {
        path: '.planning/quick/260603-pr185-workflow-improve/260603-pr185-PLAN.md',
      },
    ],
    ...overrides,
  };
}

describe('repair-planning-intake', () => {
  it('rewrites fixed 13.x milestone names to the source PR namespace', () => {
    const output = rewritePlanningText(
      '## 13.x Phase Candidates\n- 13.1: Trust gates\n- 13.4: Planning automation\n- 13.x mapping: 13.1 x1, 13.4 x1\n',
      { sourcePrNumber: 185, planningPrNumber: 190 },
    );

    assert.equal(
      output,
      '## pr185.x Phase Candidates\n- pr185.1: Trust gates\n- pr185.4: Planning automation\n- pr185.x mapping: pr185.1 x1, pr185.4 x1\n',
    );
  });

  it('rewrites planning-PR-number namespaces to the source PR namespace', () => {
    const output = rewritePlanningText(
      '## 189.x Phase Candidates\n- 189.1: Trust gates\n- 189.4: Planning automation\n- 189.x mapping: 189.1 x1, 189.4 x1\n',
      { sourcePrNumber: 181, planningPrNumber: 189 },
    );

    assert.equal(
      output,
      '## pr181.x Phase Candidates\n- pr181.1: Trust gates\n- pr181.4: Planning automation\n- pr181.x mapping: pr181.1 x1, pr181.4 x1\n',
    );
  });

  it('rejects non-planning branches', () => {
    const errors = validatePlanningPr(
      makePlanningPr({ headRefName: 'codex/not-planning' }),
    );

    assert.deepEqual(errors, [
      'PR #190 head branch must start with claude-planning-pr-',
    ]);
  });

  it('restores shared planning paths and rewrites only quick artifacts', () => {
    const tmpDir = makeTempDir();
    const originalCwd = process.cwd();
    const calls: Array<{ command: string; args: string[] }> = [];
    const quickDir = path.join(
      tmpDir,
      '.planning/quick/260603-pr185-workflow-improve',
    );
    const quickPlanPath = path.join(quickDir, '260603-pr185-PLAN.md');
    const quickSummaryPath = path.join(quickDir, '260603-pr185-SUMMARY.md');

    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.mkdirSync(quickDir, { recursive: true });
    fs.writeFileSync(
      quickPlanPath,
      '## 13.x Phase Candidates\n- 13.2: Pin turns\n',
    );
    fs.writeFileSync(quickSummaryPath, '- 13.x mapping: 13.2 x1\n');

    process.chdir(tmpDir);
    try {
      const result = repairPlanningIntake({
        planningPrNumber: 190,
        pr: makePlanningPr({
          files: [
            {
              path: '.planning/quick/260603-pr185-workflow-improve/260603-pr185-PLAN.md',
            },
            {
              path: '.planning/quick/260603-pr185-workflow-improve/260603-pr185-SUMMARY.md',
            },
            {
              path: '.planning/quick/260603-pr182-workflow-improve/260603-pr182-PLAN.md',
            },
          ],
        }),
        runCommand(command: string, args: string[]) {
          calls.push({ command, args });
          return '';
        },
      });

      assert.deepEqual(result.changed_paths, [
        '.planning/quick/260603-pr185-workflow-improve/260603-pr185-PLAN.md',
        '.planning/quick/260603-pr185-workflow-improve/260603-pr185-SUMMARY.md',
      ]);
      assert.equal(result.body_updated, true);
      assert.equal(
        fs.readFileSync(quickPlanPath, 'utf8'),
        '## pr185.x Phase Candidates\n- pr185.2: Pin turns\n',
      );
      assert.equal(
        fs.readFileSync(quickSummaryPath, 'utf8'),
        '- pr185.x mapping: pr185.2 x1\n',
      );
    } finally {
      process.chdir(originalCwd);
    }

    assert.deepEqual(calls[0], {
      command: 'git',
      args: ['fetch', 'origin', 'main', '--depth=1'],
    });
    assert.deepEqual(calls[1], {
      command: 'git',
      args: [
        'restore',
        '--source',
        'origin/main',
        '--',
        ...SHARED_PLANNING_PATHS,
        '.planning/quick/260603-pr182-workflow-improve/260603-pr182-PLAN.md',
      ],
    });
    assert.deepEqual(calls[2].command, 'gh');
    assert.deepEqual(calls[2].args.slice(0, 4), [
      'pr',
      'edit',
      '190',
      '--body-file',
    ]);
  });
});
