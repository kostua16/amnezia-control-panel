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
  getPhaseDisplayId,
  normalizePhaseSuggestions,
  renderQuickPlan,
  renderQuickSummary,
  run,
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
});
