const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROADMAP_PATH = '.planning/ROADMAP.md';
const ROADMAP_INTAKE_START = '<!-- AUTO-13X-INTAKE-START -->';
const ROADMAP_INTAKE_END = '<!-- AUTO-13X-INTAKE-END -->';
const PHASE_INTAKE_START = '<!-- AUTO-PR-IMPROVE-START -->';
const PHASE_INTAKE_END = '<!-- AUTO-PR-IMPROVE-END -->';

const PHASE_METADATA = {
  '13.1': {
    dir: '.planning/phases/13.1-workflow-governance-hardening',
    plan: '13.1-PLAN.md',
    title: 'Workflow governance hardening'
  },
  '13.2': {
    dir: '.planning/phases/13.2-ci-supply-chain-correctness',
    plan: '13.2-PLAN.md',
    title: 'CI and supply-chain correctness'
  },
  '13.3': {
    dir: '.planning/phases/13.3-pr-finalizer-approval-policy',
    plan: '13.3-PLAN.md',
    title: 'PR finalizer and approval policy'
  },
  '13.4': {
    dir: '.planning/phases/13.4-claude-gsd-planning-automation',
    plan: '13.4-PLAN.md',
    title: 'Claude+GSD planning automation'
  }
};

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe']
  }).trim();
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

function upsertNamedBlock(content, entryId, renderedBlock) {
  const startMarker = `<!-- ${entryId} START -->`;
  const endMarker = `<!-- ${entryId} END -->`;
  const blockRegex = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n?`, 'g');
  const cleaned = content.replace(blockRegex, '').replace(/\n{3,}/g, '\n\n');

  if (!cleaned.includes(PHASE_INTAKE_START) || !cleaned.includes(PHASE_INTAKE_END)) {
    throw new Error(`Missing phase intake markers in phase plan file`);
  }

  return cleaned.replace(
    PHASE_INTAKE_END,
    `${renderedBlock}\n${PHASE_INTAKE_END}`
  );
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function summarizePhaseSuggestions(phaseSuggestions) {
  const counts = new Map();
  for (const suggestion of phaseSuggestions) {
    counts.set(suggestion.phase, (counts.get(suggestion.phase) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return 'no new 13.x milestone suggestions';
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([phase, count]) => `${phase} x${count}`)
    .join(', ');
}

function escapeInline(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/`/g, "'")
    .trim();
}

function renderQuickPlan({
  sourcePrNumber,
  sourcePrTitle,
  sourcePrUrl,
  summary,
  quickTasks,
  phaseSuggestions
}) {
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
    '## Quick Wins'
  ];

  if (quickTasks.length === 0) {
    lines.push('- None identified in this run.');
  } else {
    for (const task of quickTasks) {
      lines.push(
        `- ${task.title} -- ${task.rationale} (owner: ${task.owner || 'maintainer'}, type: ${task.artifact_type || 'quick task'})`
      );
    }
  }

  lines.push('', '## 13.x Phase Candidates');

  if (phaseSuggestions.length === 0) {
    lines.push('- None identified in this run.');
  } else {
    for (const suggestion of phaseSuggestions) {
      lines.push(
        `- ${suggestion.phase}: ${suggestion.title} -- ${suggestion.rationale} (owner: ${suggestion.owner || 'maintainer'})`
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
  phaseSuggestions
}) {
  return [
    `# Summary: PR #${sourcePrNumber} workflow improvement intake`,
    '',
    `- Source PR: ${sourcePrUrl}`,
    `- Summary: ${summary}`,
    `- Quick tasks: ${quickTasks.length}`,
    `- Phase suggestions: ${phaseSuggestions.length}`,
    `- 13.x mapping: ${summarizePhaseSuggestions(phaseSuggestions)}`
  ].join('\n') + '\n';
}

function buildPhaseBlock(sourcePrNumber, sourcePrTitle, sourcePrUrl, suggestions) {
  const entryId = `PR-IMPROVE:${sourcePrNumber}`;
  const body = [
    `<!-- ${entryId} START -->`,
    `### Intake from PR #${sourcePrNumber}: ${sourcePrTitle}`,
    `- Source: ${sourcePrUrl}`
  ];

  for (const suggestion of suggestions) {
    body.push(`- ${suggestion.title} -- ${suggestion.rationale} (owner: ${suggestion.owner || 'maintainer'})`);
  }

  body.push(`<!-- ${entryId} END -->`, '');
  return body.join('\n');
}

function collectTrackedPaths(quickDir, quickPlanPath, quickSummaryPath) {
  const tracked = [ROADMAP_PATH, quickPlanPath, quickSummaryPath];
  for (const phase of Object.values(PHASE_METADATA)) {
    tracked.push(path.join(phase.dir, phase.plan));
  }
  tracked.push(quickDir);
  return tracked;
}

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
const summary = escapeInline(suggestions.summary || 'Claude+GSD generated no summary.');
const quickTasks = Array.isArray(suggestions.quick_tasks) ? suggestions.quick_tasks : [];
const phaseSuggestions = Array.isArray(suggestions.phase_suggestions)
  ? suggestions.phase_suggestions.filter((item) => PHASE_METADATA[item.phase])
  : [];

const dateStamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
const quickSlug = `${dateStamp}-pr${sourcePrNumber}-workflow-improve`;
const quickDir = path.join('.planning', 'quick', quickSlug);
const quickPlanPath = path.join(quickDir, `${dateStamp}-pr${sourcePrNumber}-PLAN.md`);
const quickSummaryPath = path.join(quickDir, `${dateStamp}-pr${sourcePrNumber}-SUMMARY.md`);
const quickArtifactPath = quickPlanPath;
const branchName = `claude-planning-pr-${sourcePrNumber}`;

if (!dryRun) {
  run('git', ['fetch', 'origin', baseRef, '--depth=1'], { capture: false });
  run('git', ['checkout', '-B', branchName, `origin/${baseRef}`], { capture: false });
}

writeFile(
  quickPlanPath,
  renderQuickPlan({
    sourcePrNumber,
    sourcePrTitle,
    sourcePrUrl,
    summary,
    quickTasks,
    phaseSuggestions
  })
);

writeFile(
  quickSummaryPath,
  renderQuickSummary({
    sourcePrNumber,
    sourcePrUrl,
    summary,
    quickTasks,
    phaseSuggestions
  })
);

let roadmap = fs.readFileSync(ROADMAP_PATH, 'utf8');
const roadmapLine = `- PR #${sourcePrNumber}: ${sourcePrTitle} -- ${summarizePhaseSuggestions(phaseSuggestions)}. Quick artifact: \`${quickArtifactPath}\`.`;
roadmap = upsertSingleLineEntry(
  roadmap,
  ROADMAP_INTAKE_START,
  ROADMAP_INTAKE_END,
  `PR-IMPROVE:${sourcePrNumber}`,
  roadmapLine
);
fs.writeFileSync(ROADMAP_PATH, roadmap);

const suggestionsByPhase = new Map();
for (const suggestion of phaseSuggestions) {
  if (!suggestionsByPhase.has(suggestion.phase)) {
    suggestionsByPhase.set(suggestion.phase, []);
  }
  suggestionsByPhase.get(suggestion.phase).push(suggestion);
}

for (const [phaseNumber, metadata] of Object.entries(PHASE_METADATA)) {
  const planPath = path.join(metadata.dir, metadata.plan);
  let content = fs.readFileSync(planPath, 'utf8');
  const phaseBlocks = suggestionsByPhase.get(phaseNumber) ?? [];
  const entryId = `PR-IMPROVE:${sourcePrNumber}`;

  const startMarker = `<!-- ${entryId} START -->`;
  const endMarker = `<!-- ${entryId} END -->`;
  const blockRegex = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n?`, 'g');
  content = content.replace(blockRegex, '');

  if (phaseBlocks.length > 0) {
    content = upsertNamedBlock(
      content,
      entryId,
      buildPhaseBlock(sourcePrNumber, sourcePrTitle, sourcePrUrl, phaseBlocks)
    );
  }

  fs.writeFileSync(planPath, content.replace(/\n{3,}/g, '\n\n'));
}

const trackedPaths = collectTrackedPaths(quickDir, quickPlanPath, quickSummaryPath);

if (dryRun) {
  process.stdout.write(
    JSON.stringify(
      {
        dry_run: true,
        branch_name: branchName,
        quick_artifact_path: quickArtifactPath,
        tracked_paths: trackedPaths
      },
      null,
      2
    )
  );
  process.exit(0);
}

run('git', ['add', ...trackedPaths], { capture: false });

let commitCreated = false;
try {
  run(
    'git',
    ['commit', '-m', `docs(planning): intake workflow improvements from PR #${sourcePrNumber}`],
    { capture: false }
  );
  commitCreated = true;
} catch (error) {
  const status = run('git', ['status', '--short', '--', ...trackedPaths]);
  if (status) {
    throw error;
  }
}

if (commitCreated) {
  run('git', ['push', '--force-with-lease', 'origin', branchName], { capture: false });
}

let existingPr = '';
try {
  existingPr = run('gh', ['pr', 'list', '--head', branchName, '--state', 'open', '--json', 'number,url']);
} catch (error) {
  existingPr = '[]';
}

const existing = JSON.parse(existingPr || '[]')[0] ?? null;
const bodyFile = path.join('.git', `planning-pr-${sourcePrNumber}.md`);
writeFile(
  bodyFile,
  [
    `## Claude+GSD Planning Intake`,
    '',
    `Source PR: #${sourcePrNumber} (${sourcePrUrl})`,
    '',
    `Summary: ${summary}`,
    '',
    `Quick artifact: \`${quickArtifactPath}\``,
    '',
    `13.x mapping: ${summarizePhaseSuggestions(phaseSuggestions)}`,
    '',
    'This draft PR is intentionally manual-only and should never be auto-approved or auto-merged.'
  ].join('\n') + '\n'
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
      'planning-draft-open'
    ],
    { capture: false }
  );
} else {
  prUrl = run(
    'gh',
    [
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
      '--draft',
      '--label',
      'planning-draft-open'
    ]
  );
}

process.stdout.write(
  JSON.stringify(
    {
      dry_run: false,
      branch_name: branchName,
      pr_url: prUrl,
      quick_artifact_path: quickArtifactPath,
      commit_created: commitCreated
    },
    null,
    2
  )
);
