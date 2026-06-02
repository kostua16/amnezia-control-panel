import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
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
            phase: '13.4',
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
    assert.equal(output.summary, 'sample planning intake');
    assert.equal(output.quick_task_count, 1);
    assert.equal(output.phase_suggestion_count, 1);
    assert.match(
      output.quick_artifact_path,
      /^\.planning\/quick\/\d{6}-pr177-workflow-improve\/\d{6}-pr177-PLAN\.md$/,
    );
  });
});
