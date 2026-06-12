/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROADMAP_PATH = '.planning/ROADMAP.md';
const ROADMAP_INTAKE_START = '<!-- AUTO-PR-IMPROVE-INTAKE-START -->';
const ROADMAP_INTAKE_END = '<!-- AUTO-PR-IMPROVE-INTAKE-END -->';
const LEGACY_ROADMAP_INTAKE_START = '<!-- AUTO-13X-INTAKE-START -->';
const LEGACY_ROADMAP_INTAKE_END = '<!-- AUTO-13X-INTAKE-END -->';

const PHASE_BUCKETS = [
  {
    key: 'workflow-governance',
    index: 1,
    title: 'Workflow governance hardening',
  },
  {
    key: 'ci-correctness',
    index: 2,
    title: 'CI and supply-chain correctness',
  },
  {
    key: 'approval-policy',
    index: 3,
    title: 'PR finalizer and approval policy',
  },
  {
    key: 'planning-automation',
    index: 4,
    title: 'Claude+GSD planning automation',
  },
];

const PHASE_BUCKET_BY_KEY = new Map(
  PHASE_BUCKETS.map((bucket) => [bucket.key, bucket]),
);
const PHASE_BUCKET_ALIASES = new Map([
  ['13.1', 'workflow-governance'],
  ['13.2', 'ci-correctness'],
  ['13.3', 'approval-policy'],
  ['13.4', 'planning-automation'],
]);

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function run(command, args, options = {}) {
  const stdout =
    execFileSync(command, args, {
      encoding: 'utf8',
      env: process.env,
      stdio:
        options.capture === false
          ? ['ignore', 'pipe', 'inherit']
          : ['ignore', 'pipe', 'pipe'],
    }) ?? '';

  if (options.capture === false && stdout) {
    process.stderr.write(stdout);
  }

  return stdout.trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function upsertSingleLineEntry(content, startMarker, endMarker, entryId, line) {
  if (!content.includes(startMarker) || !content.includes(endMarker)) {
    throw new Error(`Missing marker pair ${startMarker} / ${endMarker}`);
  }

  const [beforeBlock, afterStart] = content.split(startMarker);
  const [blockBody, afterBlock] = afterStart.split(endMarker);
  const lines = blockBody
    .split('\n')
    .map((value) => value.trimEnd())
    .filter((value) => value.trim().length > 0)
    .filter((value) => !value.startsWith(`<!-- ${entryId} -->`));

  lines.push(`<!-- ${entryId} --> ${line}`);
  lines.sort((left, right) => left.localeCompare(right));

  return `${beforeBlock}${startMarker}\n${lines.join('\n')}\n${endMarker}${afterBlock}`;
}

function ensureRoadmapIntakeMarkers(content) {
  if (
    content.includes(ROADMAP_INTAKE_START) &&
    content.includes(ROADMAP_INTAKE_END)
  ) {
    return content;
  }

  if (
    content.includes(LEGACY_ROADMAP_INTAKE_START) &&
    content.includes(LEGACY_ROADMAP_INTAKE_END)
  ) {
    return content
      .replace(LEGACY_ROADMAP_INTAKE_START, ROADMAP_INTAKE_START)
      .replace(LEGACY_ROADMAP_INTAKE_END, ROADMAP_INTAKE_END);
  }

  throw new Error(
    `Missing roadmap intake markers ${ROADMAP_INTAKE_START} / ${ROADMAP_INTAKE_END}`,
  );
}

function getPhaseNamespace(sourcePrNumber) {
  return `pr${sourcePrNumber}`;
}

function normalizeBucketKey(rawBucket) {
  const value = String(rawBucket ?? '').trim();
  if (PHASE_BUCKET_BY_KEY.has(value)) {
    return value;
  }

  if (PHASE_BUCKET_ALIASES.has(value)) {
    return PHASE_BUCKET_ALIASES.get(value);
  }

  const numericSuffixMatch = value.match(/^(?:pr)?\d+\.(\d)$/);
  if (numericSuffixMatch) {
    const index = Number(numericSuffixMatch[1]);
    return PHASE_BUCKETS.find((bucket) => bucket.index === index)?.key ?? null;
  }

  return null;
}

function getPhaseDisplayId(sourcePrNumber, bucketKey) {
  const bucket = PHASE_BUCKET_BY_KEY.get(bucketKey);
  if (!bucket) {
    throw new Error(`Unknown phase bucket "${bucketKey}"`);
  }

  return `${getPhaseNamespace(sourcePrNumber)}.${bucket.index}`;
}

function normalizePhaseSuggestion(item, sourcePrNumber) {
  const bucket = normalizeBucketKey(item?.bucket ?? item?.phase);
  if (!bucket) {
    return null;
  }

  return {
    ...item,
    bucket,
    phase: getPhaseDisplayId(sourcePrNumber, bucket),
  };
}

function normalizePhaseSuggestions(items, sourcePrNumber) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => normalizePhaseSuggestion(item, sourcePrNumber))
    .filter((item) => item !== null);
}

function summarizePhaseSuggestions(phaseSuggestions, sourcePrNumber) {
  const counts = new Map();
  for (const suggestion of phaseSuggestions) {
    counts.set(suggestion.phase, (counts.get(suggestion.phase) ?? 0) + 1);
  }

  const namespace = getPhaseNamespace(sourcePrNumber);
  if (counts.size === 0) {
    return `no new ${namespace}.x milestone suggestions`;
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([phase, count]) => `${phase} x${count}`)
    .join(', ');
}

function escapeInline(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderQuickPlan({
  sourcePrNumber,
  sourcePrTitle,
  sourcePrUrl,
  summary,
  quickTasks,
  phaseSuggestions,
}) {
  const namespace = getPhaseNamespace(sourcePrNumber);
  const lines = [
    `# Quick Plan: PR #${sourcePrNumber} workflow improvement intake`,
    '',
    '## Source',
    `- PR #${sourcePrNumber}: ${sourcePrTitle}`,
    `- URL: ${sourcePrUrl}`,
    '',
    '## Summary',
    summary,
    '',
    '## Quick Wins',
  ];

  if (quickTasks.length === 0) {
    lines.push('- None identified in this run.');
  } else {
    for (const task of quickTasks) {
      lines.push(
        `- ${task.title} -- ${task.rationale} (owner: ${task.owner || 'maintainer'}, type: ${task.artifact_type || 'quick task'})`,
      );
    }
  }

  lines.push('', `## ${namespace}.x Phase Candidates`);

  if (phaseSuggestions.length === 0) {
    lines.push('- None identified in this run.');
  } else {
    for (const suggestion of phaseSuggestions) {
      lines.push(
        `- ${suggestion.phase}: ${suggestion.title} -- ${suggestion.rationale} (owner: ${suggestion.owner || 'maintainer'})`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function renderQuickSummary({
  sourcePrNumber,
  sourcePrUrl,
  summary,
  quickTasks,
  phaseSuggestions,
}) {
  const namespace = getPhaseNamespace(sourcePrNumber);
  return (
    [
      `# Summary: PR #${sourcePrNumber} workflow improvement intake`,
      '',
      `- Source PR: ${sourcePrUrl}`,
      `- Summary: ${summary}`,
      `- Quick tasks: ${quickTasks.length}`,
      `- Phase suggestions: ${phaseSuggestions.length}`,
      `- ${namespace}.x mapping: ${summarizePhaseSuggestions(phaseSuggestions, sourcePrNumber)}`,
    ].join('\n') + '\n'
  );
}

function collectTrackedPaths(quickDir, quickPlanPath, quickSummaryPath) {
  return [ROADMAP_PATH, quickPlanPath, quickSummaryPath, quickDir];
}

function buildPlanningPrBody({
  sourcePrNumber,
  sourcePrUrl,
  summary,
  quickArtifactPath,
  phaseSuggestions,
}) {
  const namespace = getPhaseNamespace(sourcePrNumber);
  return (
    [
      '## Claude+GSD Planning Intake',
      '',
      `Source PR: #${sourcePrNumber} (${sourcePrUrl})`,
      '',
      `Summary: ${summary}`,
      '',
      `Quick artifact: \`${quickArtifactPath}\``,
      '',
      `${namespace}.x mapping: ${summarizePhaseSuggestions(phaseSuggestions, sourcePrNumber)}`,
      '',
      'This planning intake PR is auto-merge eligible after CI, PR Policy, core review, and security review pass.',
      'After merge, the GSD planning executor imports merged artifacts four times per day and opens implementation PRs.',
    ].join('\n') + '\n'
  );
}

function main() {
  const suggestionsFile = getArg('--suggestions-file');
  const sourcePrNumber = Number(getArg('--source-pr-number'));
  const sourcePrTitle = escapeInline(getArg('--source-pr-title'));
  const sourcePrUrl = getArg('--source-pr-url');
  const baseRef = getArg('--base-ref') ?? 'main';
  const dryRun = getArg('--dry-run', 'false') === 'true';

  if (!suggestionsFile) {
    throw new Error('--suggestions-file is required');
  }

  if (!Number.isFinite(sourcePrNumber)) {
    throw new Error('--source-pr-number must be numeric');
  }

  const suggestions = readJson(suggestionsFile);
  const summary = escapeInline(
    suggestions.summary || 'Claude+GSD generated no summary.',
  );
  const quickTasks = Array.isArray(suggestions.quick_tasks)
    ? suggestions.quick_tasks
    : [];
  const phaseSuggestions = normalizePhaseSuggestions(
    suggestions.phase_suggestions,
    sourcePrNumber,
  );

  const dateStamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const quickSlug = `${dateStamp}-pr${sourcePrNumber}-workflow-improve`;
  const quickDir = path.join('.planning', 'quick', quickSlug);
  const quickPlanPath = path.join(
    quickDir,
    `${dateStamp}-pr${sourcePrNumber}-PLAN.md`,
  );
  const quickSummaryPath = path.join(
    quickDir,
    `${dateStamp}-pr${sourcePrNumber}-SUMMARY.md`,
  );
  const quickArtifactPath = quickPlanPath;
  const branchName = `claude-planning-pr-${sourcePrNumber}`;
  const phaseNamespace = getPhaseNamespace(sourcePrNumber);

  const trackedPaths = collectTrackedPaths(
    quickDir,
    quickPlanPath,
    quickSummaryPath,
  );

  if (dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          dry_run: true,
          branch_name: branchName,
          phase_namespace: phaseNamespace,
          quick_artifact_path: quickArtifactPath,
          tracked_paths: trackedPaths,
          summary,
          quick_task_count: quickTasks.length,
          phase_suggestion_count: phaseSuggestions.length,
          phase_mapping: summarizePhaseSuggestions(
            phaseSuggestions,
            sourcePrNumber,
          ),
        },
        null,
        2,
      ),
    );
    return;
  }

  run('git', ['fetch', 'origin', baseRef, '--depth=1'], { capture: false });
  run('git', ['checkout', '-B', branchName, `origin/${baseRef}`], {
    capture: false,
  });

  writeFile(
    quickPlanPath,
    renderQuickPlan({
      sourcePrNumber,
      sourcePrTitle,
      sourcePrUrl,
      summary,
      quickTasks,
      phaseSuggestions,
    }),
  );

  writeFile(
    quickSummaryPath,
    renderQuickSummary({
      sourcePrNumber,
      sourcePrUrl,
      summary,
      quickTasks,
      phaseSuggestions,
    }),
  );

  let roadmap = ensureRoadmapIntakeMarkers(
    fs.readFileSync(ROADMAP_PATH, 'utf8'),
  );
  const roadmapLine = `- PR #${sourcePrNumber}: ${sourcePrTitle} -- ${summarizePhaseSuggestions(phaseSuggestions, sourcePrNumber)}. Quick artifact: \`${quickArtifactPath}\`.`;
  roadmap = upsertSingleLineEntry(
    roadmap,
    ROADMAP_INTAKE_START,
    ROADMAP_INTAKE_END,
    `PR-IMPROVE:${sourcePrNumber}`,
    roadmapLine,
  );
  fs.writeFileSync(ROADMAP_PATH, roadmap);

  run('git', ['add', ...trackedPaths], { capture: false });

  let commitCreated = false;
  try {
    run(
      'git',
      [
        'commit',
        '-m',
        `docs(planning): intake workflow improvements from PR #${sourcePrNumber}`,
      ],
      { capture: false },
    );
    commitCreated = true;
  } catch (error) {
    const status = run('git', ['status', '--short', '--', ...trackedPaths]);
    if (status) {
      throw error;
    }
  }

  function findExistingPlanningPr() {
    try {
      return (
        JSON.parse(
          run('gh', [
            'pr',
            'list',
            '--head',
            branchName,
            '--state',
            'open',
            '--json',
            'number,url',
          ]) || '[]',
        )[0] ?? null
      );
    } catch {
      return null;
    }
  }

  if (commitCreated) {
    try {
      run('git', ['push', '--force-with-lease', 'origin', branchName], {
        capture: false,
      });
    } catch {
      console.warn(
        `::warning::Concurrent push detected for ${branchName}; skipping stale planning PR update.`,
      );
      const existingOnConflict = findExistingPlanningPr();
      process.stdout.write(
        JSON.stringify(
          {
            dry_run: false,
            branch_name: branchName,
            phase_namespace: phaseNamespace,
            pr_url: existingOnConflict?.url ?? null,
            quick_artifact_path: quickArtifactPath,
            commit_created: commitCreated,
            skipped_due_to_push_conflict: true,
          },
          null,
          2,
        ),
      );
      return;
    }
  }

  const existing = findExistingPlanningPr();
  const bodyFile = path.join('.git', `planning-pr-${sourcePrNumber}.md`);
  writeFile(
    bodyFile,
    buildPlanningPrBody({
      sourcePrNumber,
      sourcePrUrl,
      summary,
      quickArtifactPath,
      phaseSuggestions,
    }),
  );

  let prUrl = existing?.url ?? null;

  if (existing) {
    run(
      'gh',
      [
        'pr',
        'edit',
        String(existing.number),
        '--title',
        `planning: workflow improvement follow-ups for PR #${sourcePrNumber}`,
        '--body-file',
        bodyFile,
        '--add-label',
        'planning-intake-open',
      ],
      { capture: false },
    );
  } else {
    prUrl = run('gh', [
      'pr',
      'create',
      '--base',
      baseRef,
      '--head',
      branchName,
      '--title',
      `planning: workflow improvement follow-ups for PR #${sourcePrNumber}`,
      '--body-file',
      bodyFile,
      '--label',
      'planning-intake-open',
    ]);
  }

  process.stdout.write(
    JSON.stringify(
      {
        dry_run: false,
        branch_name: branchName,
        phase_namespace: phaseNamespace,
        pr_url: prUrl,
        quick_artifact_path: quickArtifactPath,
        commit_created: commitCreated,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  PHASE_BUCKETS,
  buildPlanningPrBody,
  collectTrackedPaths,
  ensureRoadmapIntakeMarkers,
  getPhaseDisplayId,
  getPhaseNamespace,
  main,
  normalizeBucketKey,
  normalizePhaseSuggestion,
  normalizePhaseSuggestions,
  renderQuickPlan,
  renderQuickSummary,
  run,
  summarizePhaseSuggestions,
};
