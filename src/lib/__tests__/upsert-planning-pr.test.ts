import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildPlanningPrBody,
  collectTrackedPaths,
  ensureRoadmapIntakeMarkers,
  escapeInline,
  getPhaseDisplayId,
  normalizeBucketKey,
  normalizePhaseSuggestion,
  normalizePhaseSuggestions,
  renderQuickPlan,
  renderQuickSummary,
  run,
  summarizePhaseSuggestions,
  upsertSingleLineEntry,
  validatePhaseSuggestion,
  validateQuickTask,
} = require('../../../.github/workflows/scripts/upsert-planning-pr.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'upsert-planning-pr-test-'));
}

describe('upsert-planning-pr', () => {
  it('returns trimmed stdout for captured commands', () => {
    const output = run(process.execPath, [
      '-e',
      "process.stdout.write('  captured output  \\n')",
    ]);

    assert.equal(output, 'captured output');
  });

  it('does not throw for capture:false commands without stdout', () => {
    const output = run(process.execPath, ['-e', ''], { capture: false });

    assert.equal(output, '');
  });

  it('routes capture:false child stdout to stderr instead of parent stdout', () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const output = run(
        process.execPath,
        ['-e', "process.stdout.write('visible child stdout\\n')"],
        { capture: false },
      );

      assert.equal(output, 'visible child stdout');
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }

    assert.equal(stdoutChunks.join(''), '');
    assert.equal(stderrChunks.join(''), 'visible child stdout\n');
  });

  it('handles execFileSync returning null for capture:false commands', () => {
    const scriptPath = path.resolve(
      '.github/workflows/scripts/upsert-planning-pr.cjs',
    );
    const childScript = `
      const Module = require('module');
      const originalLoad = Module._load;
      const calls = [];

      Module._load = function mockLoad(request, parent, isMain) {
        if (request === 'child_process') {
          return {
            execFileSync(command, args, options) {
              calls.push({
                args,
                command,
                encoding: options.encoding,
                envMatches: options.env === process.env,
                stdio: options.stdio,
              });
              return null;
            },
          };
        }

        return originalLoad.call(this, request, parent, isMain);
      };

      const { run } = require(process.argv[1]);
      const output = run('git', ['fetch', 'origin', 'main'], { capture: false });
      process.stdout.write(JSON.stringify({ calls, output }));
    `;

    const stdout = execFileSync(
      process.execPath,
      ['-e', childScript, scriptPath],
      {
        encoding: 'utf8',
      },
    );
    const result = JSON.parse(stdout);

    assert.equal(result.output, '');
    assert.deepEqual(result.calls, [
      {
        args: ['fetch', 'origin', 'main'],
        command: 'git',
        encoding: 'utf8',
        envMatches: true,
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    ]);
  });

  it('emits valid JSON for dry-run CLI output', () => {
    const tmpDir = makeTempDir();
    const suggestionsFile = path.join(tmpDir, 'suggestions.json');
    const scriptPath = path.resolve(
      '.github/workflows/scripts/upsert-planning-pr.cjs',
    );

    fs.writeFileSync(
      suggestionsFile,
      JSON.stringify({
        summary: 'sample planning intake',
        quick_tasks: [
          {
            title: 'Document helper behavior',
            rationale: 'The workflow parser depends on JSON-only stdout.',
            owner: 'maintainer',
            artifact_type: 'quick-task',
          },
        ],
        phase_suggestions: [
          {
            bucket: 'planning-automation',
            title: 'Harden planning helper IO',
            rationale:
              'Planning automation should keep command logs out of JSON outputs.',
            owner: 'maintainer',
          },
        ],
      }),
    );

    const stdout = execFileSync(
      process.execPath,
      [
        scriptPath,
        '--suggestions-file',
        suggestionsFile,
        '--source-pr-number',
        '177',
        '--source-pr-title',
        'ci(workflows): hourly optimization - 26850375217',
        '--source-pr-url',
        'https://github.com/kostua16/amnezia-control-panel/pull/177',
        '--base-ref',
        'main',
        '--dry-run',
        'true',
      ],
      { encoding: 'utf8' },
    );
    const output = JSON.parse(stdout);

    assert.equal(output.dry_run, true);
    assert.equal(output.branch_name, 'claude-planning-pr-177');
    assert.equal(output.phase_namespace, 'pr177');
    assert.equal(output.summary, 'sample planning intake');
    assert.equal(output.quick_task_count, 1);
    assert.equal(output.phase_suggestion_count, 1);
    assert.equal(output.phase_mapping, 'pr177.4 x1');
    assert.deepEqual(
      output.tracked_paths.filter((trackedPath: string) =>
        trackedPath.includes('.planning/phases/'),
      ),
      [],
    );
    assert.match(
      output.quick_artifact_path,
      /^\.planning\/quick\/\d{6}-pr177-workflow-improve\/\d{6}-pr177-PLAN\.md$/,
    );
  });

  it('maps semantic phase buckets to source-PR phase IDs', () => {
    assert.equal(getPhaseDisplayId(185, 'workflow-governance'), 'pr185.1');
    assert.equal(getPhaseDisplayId(185, 'ci-correctness'), 'pr185.2');
    assert.equal(getPhaseDisplayId(185, 'approval-policy'), 'pr185.3');
    assert.equal(getPhaseDisplayId(185, 'planning-automation'), 'pr185.4');
  });

  it('keeps legacy numeric phase suggestions backward-compatible', () => {
    const suggestions = normalizePhaseSuggestions(
      [
        {
          phase: '13.1',
          title: 'Centralize trust gates',
          rationale: 'The old schema emitted fixed milestone names.',
          owner: 'maintainer',
        },
      ],
      181,
    );

    assert.deepEqual(
      suggestions.map((suggestion: { bucket: string; phase: string }) => ({
        bucket: suggestion.bucket,
        phase: suggestion.phase,
      })),
      [{ bucket: 'workflow-governance', phase: 'pr181.1' }],
    );
  });

  it('renders quick artifacts with source-PR namespace labels', () => {
    const phaseSuggestions = normalizePhaseSuggestions(
      [
        {
          bucket: 'planning-automation',
          title: 'Add repair command',
          rationale: 'Planning PRs should be deterministic.',
          owner: 'maintainer',
        },
      ],
      192,
    );

    const plan = renderQuickPlan({
      sourcePrNumber: 192,
      sourcePrTitle: 'planning namespace fix',
      sourcePrUrl: 'https://github.com/kostua16/amnezia-control-panel/pull/192',
      summary: 'sample',
      quickTasks: [],
      phaseSuggestions,
    });
    const summary = renderQuickSummary({
      sourcePrNumber: 192,
      sourcePrUrl: 'https://github.com/kostua16/amnezia-control-panel/pull/192',
      summary: 'sample',
      quickTasks: [],
      phaseSuggestions,
    });

    assert.match(plan, /## pr192\.x Phase Candidates/);
    assert.match(plan, /- pr192\.4: Add repair command/);
    assert.match(summary, /- pr192\.x mapping: pr192\.4 x1/);
    assert.doesNotMatch(plan, /13\.x|13\.[1-4]/);
    assert.doesNotMatch(summary, /13\.x|13\.[1-4]/);
  });

  it('renders planning PR bodies with the merge-to-execute lifecycle', () => {
    const phaseSuggestions = normalizePhaseSuggestions(
      [
        {
          bucket: 'planning-automation',
          title: 'Execute merged planning artifacts',
          rationale: 'Planning intake should become implementation work.',
          owner: 'maintainer',
        },
      ],
      237,
    );
    const body = buildPlanningPrBody({
      sourcePrNumber: 237,
      sourcePrUrl: 'https://github.com/kostua16/amnezia-control-panel/pull/237',
      summary: 'sample',
      quickArtifactPath:
        '.planning/quick/260605-pr237-workflow-improve/260605-pr237-PLAN.md',
      phaseSuggestions,
    });

    assert.match(body, /auto-merge eligible after CI, PR Policy, core review/);
    assert.match(
      body,
      /GSD planning executor imports merged artifacts four times per day/,
    );
    assert.doesNotMatch(body, /draft PR|manual-only/i);
  });

  // --- escapeInline tests ---
  describe('escapeInline', () => {
    it('collapses whitespace and trims', () => {
      assert.equal(escapeInline('  hello   world  '), 'hello world');
    });

    it('handles null and undefined', () => {
      assert.equal(escapeInline(null), '');
      assert.equal(escapeInline(undefined), '');
    });

    it('escapes backticks to single quotes', () => {
      assert.equal(escapeInline('use `npm test` here'), "use 'npm test' here");
    });

    it('strips HTML comments', () => {
      assert.equal(escapeInline('before<!-- hidden -->after'), 'beforeafter');
    });

    it('strips markdown links, keeping link text', () => {
      assert.equal(
        escapeInline('see [docs](https://example.com) for help'),
        'see docs for help',
      );
    });

    it('handles combined injection patterns', () => {
      const result = escapeInline(
        'title <!-- comment --> [link](http://x) `code`',
      );
      assert.equal(result.includes('title'), true);
      assert.equal(result.includes('link'), true);
      assert.equal(result.includes("'code'"), true);
      assert.equal(result.includes('<!--'), false);
      assert.equal(result.includes('['), false);
    });
  });

  // --- upsertSingleLineEntry tests ---
  describe('upsertSingleLineEntry', () => {
    it('inserts a new entry between markers', () => {
      const content = 'header\n<!-- START -->\n<!-- END -->\nfooter';
      const result = upsertSingleLineEntry(
        content,
        '<!-- START -->',
        '<!-- END -->',
        'A',
        'line from A',
      );
      assert.match(result, /<!-- A --> line from A/);
      assert.match(result, /header/);
      assert.match(result, /footer/);
    });

    it('updates an existing entry by ID', () => {
      const content =
        'header\n<!-- START -->\n<!-- A --> old line\n<!-- END -->\nfooter';
      const result = upsertSingleLineEntry(
        content,
        '<!-- START -->',
        '<!-- END -->',
        'A',
        'new line from A',
      );
      assert.equal(result.includes('old line'), false);
      assert.match(result, /<!-- A --> new line from A/);
    });

    it('sorts entries alphabetically', () => {
      const content = 'header\n<!-- START -->\n<!-- END -->\nfooter';
      const r1 = upsertSingleLineEntry(
        content,
        '<!-- START -->',
        '<!-- END -->',
        'Z',
        'z entry',
      );
      const r2 = upsertSingleLineEntry(
        r1,
        '<!-- START -->',
        '<!-- END -->',
        'A',
        'a entry',
      );
      const lines = r2
        .split('<!-- START -->\n')[1]!
        .split('\n<!-- END -->')[0]!
        .split('\n')
        .filter((l: string) => l.trim().length > 0);
      assert.match(lines[0], /<!-- A -->/);
      assert.match(lines[1], /<!-- Z -->/);
    });

    it('throws on missing markers', () => {
      assert.throws(
        () =>
          upsertSingleLineEntry(
            'no markers',
            '<!-- S -->',
            '<!-- E -->',
            'A',
            'line',
          ),
        /Missing marker pair/,
      );
    });
  });

  // --- ensureRoadmapIntakeMarkers tests ---
  describe('ensureRoadmapIntakeMarkers', () => {
    it('returns content unchanged when markers present', () => {
      const content =
        'top\n<!-- AUTO-PR-IMPROVE-INTAKE-START -->\n<!-- AUTO-PR-IMPROVE-INTAKE-END -->\nbot';
      assert.equal(ensureRoadmapIntakeMarkers(content), content);
    });

    it('migrates legacy markers', () => {
      const content =
        'top\n<!-- AUTO-13X-INTAKE-START -->\n<!-- AUTO-13X-INTAKE-END -->\nbot';
      const result = ensureRoadmapIntakeMarkers(content);
      assert.match(result, /AUTO-PR-IMPROVE-INTAKE-START/);
      assert.equal(result.includes('AUTO-13X-INTAKE'), false);
    });

    it('throws when markers are missing', () => {
      assert.throws(
        () => ensureRoadmapIntakeMarkers('no markers at all'),
        /Missing roadmap intake markers/,
      );
    });
  });

  // --- collectTrackedPaths tests ---
  describe('collectTrackedPaths', () => {
    it('returns expected paths including ROADMAP_PATH', () => {
      const paths = collectTrackedPaths(
        '.planning/quick/test-dir',
        '.planning/quick/test-dir/PLAN.md',
        '.planning/quick/test-dir/SUMMARY.md',
      );
      assert.equal(paths.length, 4);
      assert.ok(paths.includes('.planning/ROADMAP.md'));
      assert.ok(paths.includes('.planning/quick/test-dir'));
      assert.ok(paths.includes('.planning/quick/test-dir/PLAN.md'));
      assert.ok(paths.includes('.planning/quick/test-dir/SUMMARY.md'));
    });
  });

  // --- summarizePhaseSuggestions tests ---
  describe('summarizePhaseSuggestions', () => {
    it('returns "no new" for empty suggestions', () => {
      assert.equal(
        summarizePhaseSuggestions([], 200),
        'no new pr200.x milestone suggestions',
      );
    });

    it('returns single phase count', () => {
      const suggestions = [{ phase: 'pr200.1', title: 'test' }];
      assert.equal(summarizePhaseSuggestions(suggestions, 200), 'pr200.1 x1');
    });

    it('returns sorted multi-phase summary', () => {
      const suggestions = [
        { phase: 'pr200.3', title: 'a' },
        { phase: 'pr200.1', title: 'b' },
        { phase: 'pr200.3', title: 'c' },
      ];
      assert.equal(
        summarizePhaseSuggestions(suggestions, 200),
        'pr200.1 x1, pr200.3 x2',
      );
    });
  });

  // --- normalizePhaseSuggestion tests ---
  describe('normalizePhaseSuggestion', () => {
    it('returns null for unknown bucket', () => {
      assert.equal(
        normalizePhaseSuggestion({ bucket: 'unknown-bucket' }, 200),
        null,
      );
    });

    it('normalizes valid bucket key', () => {
      const result = normalizePhaseSuggestion(
        { bucket: 'ci-correctness', title: 't', rationale: 'r' },
        200,
      );
      assert.equal(result.bucket, 'ci-correctness');
      assert.equal(result.phase, 'pr200.2');
    });

    it('normalizes legacy numeric phase alias', () => {
      const result = normalizePhaseSuggestion(
        { phase: '13.3', title: 't', rationale: 'r' },
        200,
      );
      assert.equal(result.bucket, 'approval-policy');
      assert.equal(result.phase, 'pr200.3');
    });
  });

  // --- normalizeBucketKey tests ---
  describe('normalizeBucketKey', () => {
    it('returns key directly for known buckets', () => {
      assert.equal(
        normalizeBucketKey('workflow-governance'),
        'workflow-governance',
      );
      assert.equal(
        normalizeBucketKey('planning-automation'),
        'planning-automation',
      );
    });

    it('resolves aliases', () => {
      assert.equal(normalizeBucketKey('13.1'), 'workflow-governance');
      assert.equal(normalizeBucketKey('13.4'), 'planning-automation');
    });

    it('resolves pr.N.N pattern', () => {
      assert.equal(normalizeBucketKey('pr13.2'), 'ci-correctness');
    });

    it('returns null for unknown values', () => {
      assert.equal(normalizeBucketKey('nonsense'), null);
      assert.equal(normalizeBucketKey(null), null);
      assert.equal(normalizeBucketKey(''), null);
    });
  });

  // --- validateQuickTask tests ---
  describe('validateQuickTask', () => {
    it('returns errors for non-object', () => {
      const errors = validateQuickTask('not-an-object', 0);
      assert.ok(errors.length > 0);
      assert.match(errors[0], /not an object/);
    });

    it('returns errors for missing title and rationale', () => {
      const errors = validateQuickTask({ owner: 'x' }, 0);
      assert.equal(errors.length, 2);
      assert.ok(errors.some((e: string) => e.includes('title')));
      assert.ok(errors.some((e: string) => e.includes('rationale')));
    });

    it('returns empty for valid task', () => {
      const errors = validateQuickTask(
        { title: 't', rationale: 'r', owner: 'm' },
        0,
      );
      assert.equal(errors.length, 0);
    });
  });

  // --- validatePhaseSuggestion tests ---
  describe('validatePhaseSuggestion', () => {
    it('returns errors for non-object', () => {
      const errors = validatePhaseSuggestion(null, 0);
      assert.ok(errors.length > 0);
      assert.match(errors[0], /not an object/);
    });

    it('returns errors for missing title, rationale, and bucket', () => {
      const errors = validatePhaseSuggestion({}, 0);
      assert.equal(errors.length, 3);
    });

    it('returns empty for valid suggestion', () => {
      const errors = validatePhaseSuggestion(
        { bucket: 'ci-correctness', title: 't', rationale: 'r' },
        0,
      );
      assert.equal(errors.length, 0);
    });

    it('accepts valid alias phase field', () => {
      const errors = validatePhaseSuggestion(
        { phase: '13.2', title: 't', rationale: 'r' },
        0,
      );
      assert.equal(errors.length, 0);
    });
  });

  // --- renderQuickPlan full structure tests ---
  describe('renderQuickPlan', () => {
    it('includes all required sections', () => {
      const plan = renderQuickPlan({
        sourcePrNumber: 100,
        sourcePrTitle: 'test PR',
        sourcePrUrl: 'https://example.com/pull/100',
        summary: 'test summary',
        quickTasks: [],
        phaseSuggestions: [],
      });
      assert.match(plan, /# Quick Plan: PR #100 workflow improvement intake/);
      assert.match(plan, /## Source/);
      assert.match(plan, /## Summary/);
      assert.match(plan, /## Quick Wins/);
      assert.match(plan, /## pr100\.x Phase Candidates/);
    });

    it('shows "None identified" for empty arrays', () => {
      const plan = renderQuickPlan({
        sourcePrNumber: 100,
        sourcePrTitle: 't',
        sourcePrUrl: 'https://example.com/pull/100',
        summary: 's',
        quickTasks: [],
        phaseSuggestions: [],
      });
      assert.match(plan, /Quick Wins[\s\S]*None identified in this run/);
      assert.match(plan, /Phase Candidates[\s\S]*None identified in this run/);
    });

    it('renders quick tasks with owner and type', () => {
      const plan = renderQuickPlan({
        sourcePrNumber: 100,
        sourcePrTitle: 't',
        sourcePrUrl: 'https://example.com/pull/100',
        summary: 's',
        quickTasks: [
          {
            title: 'Fix X',
            rationale: 'broken',
            owner: 'team',
            artifact_type: 'quick-task',
          },
        ],
        phaseSuggestions: [],
      });
      assert.match(plan, /Fix X -- broken \(owner: team, type: quick-task\)/);
    });

    it('defaults owner to maintainer when missing', () => {
      const plan = renderQuickPlan({
        sourcePrNumber: 100,
        sourcePrTitle: 't',
        sourcePrUrl: 'https://example.com/pull/100',
        summary: 's',
        quickTasks: [{ title: 'Fix X', rationale: 'broken' }],
        phaseSuggestions: [],
      });
      assert.match(plan, /\(owner: maintainer, type: quick task\)/);
    });
  });

  // --- renderQuickSummary tests ---
  describe('renderQuickSummary', () => {
    it('includes counts and mapping', () => {
      const summary = renderQuickSummary({
        sourcePrNumber: 100,
        sourcePrUrl: 'https://example.com/pull/100',
        summary: 'test',
        quickTasks: [{ title: 't', rationale: 'r' }],
        phaseSuggestions: [],
      });
      assert.match(summary, /- Quick tasks: 1/);
      assert.match(summary, /- Phase suggestions: 0/);
      assert.match(summary, /no new pr100\.x milestone suggestions/);
    });
  });
});
