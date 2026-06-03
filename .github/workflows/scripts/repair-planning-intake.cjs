/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PLANNING_BRANCH_PREFIX = 'claude-planning-pr-';
const SHARED_PLANNING_PATHS = ['.planning/ROADMAP.md', '.planning/phases'];

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

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => value !== null))];
}

function extractSourcePrNumber(body) {
  const match = String(body ?? '').match(/\bSource PR:\s*#(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function getNamespaceCandidates({ sourcePrNumber, planningPrNumber }) {
  return uniqueValues([
    13,
    Number(sourcePrNumber),
    Number(planningPrNumber),
  ]).map(String);
}

function rewritePlanningText(content, { sourcePrNumber, planningPrNumber }) {
  const namespace = `pr${sourcePrNumber}`;
  const candidatePattern = getNamespaceCandidates({
    sourcePrNumber,
    planningPrNumber,
  })
    .map(escapeRegExp)
    .join('|');

  return String(content ?? '')
    .replace(
      new RegExp(`\\b(?:${candidatePattern})\\.x\\b`, 'g'),
      `${namespace}.x`,
    )
    .replace(
      new RegExp(`\\b(?:${candidatePattern})\\.([1-4])\\b`, 'g'),
      `${namespace}.$1`,
    );
}

function extractQuickArtifactPath(pr, sourcePrNumber) {
  const bodyMatch = String(pr.body ?? '').match(/Quick artifact:\s*`([^`]+)`/i);
  if (bodyMatch) {
    return bodyMatch[1];
  }

  const sourcePattern = new RegExp(
    `^\\.planning/quick/[^/]*-pr${sourcePrNumber}-workflow-improve/[^/]+-PLAN\\.md$`,
  );
  return (pr.files ?? []).find((file) => sourcePattern.test(file.path))?.path;
}

function quickSummaryPathFromPlan(quickPlanPath) {
  if (!quickPlanPath.endsWith('-PLAN.md')) {
    throw new Error(`Quick artifact is not a PLAN file: ${quickPlanPath}`);
  }

  return quickPlanPath.replace(/-PLAN\.md$/, '-SUMMARY.md');
}

function validatePlanningPr(pr) {
  const errors = [];

  if (pr.state !== 'OPEN') {
    errors.push(`PR #${pr.number} is not open`);
  }

  if (pr.isCrossRepository) {
    errors.push(`PR #${pr.number} is cross-repository`);
  }

  if (!String(pr.headRefName ?? '').startsWith(PLANNING_BRANCH_PREFIX)) {
    errors.push(
      `PR #${pr.number} head branch must start with ${PLANNING_BRANCH_PREFIX}`,
    );
  }

  return errors;
}

function loadPlanningPr(planningPrNumber, runCommand = run) {
  return JSON.parse(
    runCommand('gh', [
      'pr',
      'view',
      String(planningPrNumber),
      '--json',
      'number,title,url,state,isDraft,headRefName,baseRefName,isCrossRepository,body,files',
    ]),
  );
}

function getNonTargetQuickPaths(pr, targetPaths) {
  const targetSet = new Set(targetPaths);
  return (pr.files ?? [])
    .map((file) => file.path)
    .filter((filePath) => filePath.startsWith('.planning/quick/'))
    .filter((filePath) => !targetSet.has(filePath));
}

function restoreSharedPlanningPaths(
  baseRef,
  runCommand = run,
  extraPaths = [],
) {
  const restorePaths = [...SHARED_PLANNING_PATHS, ...extraPaths];
  runCommand('git', ['fetch', 'origin', baseRef, '--depth=1'], {
    capture: false,
  });
  runCommand(
    'git',
    ['restore', '--source', `origin/${baseRef}`, '--', ...restorePaths],
    { capture: false },
  );

  return restorePaths;
}

function writeFileIfChanged(filePath, content) {
  const original = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8')
    : null;

  if (original !== content) {
    writeFile(filePath, content);
    return true;
  }

  return false;
}

function rewriteQuickArtifacts({
  quickPlanPath,
  quickSummaryPath,
  quickPlanContent = null,
  quickSummaryContent = null,
  sourcePrNumber,
  planningPrNumber,
}) {
  const originalPlan =
    quickPlanContent ?? fs.readFileSync(quickPlanPath, 'utf8');
  const originalSummary =
    quickSummaryContent ?? fs.readFileSync(quickSummaryPath, 'utf8');

  const rewrite = (content) =>
    rewritePlanningText(content, { sourcePrNumber, planningPrNumber });

  const changedPaths = [];
  if (writeFileIfChanged(quickPlanPath, rewrite(originalPlan))) {
    changedPaths.push(quickPlanPath);
  }
  if (writeFileIfChanged(quickSummaryPath, rewrite(originalSummary))) {
    changedPaths.push(quickSummaryPath);
  }

  return changedPaths;
}

function updatePrBodyIfChanged({
  planningPrNumber,
  body,
  sourcePrNumber,
  runCommand = run,
}) {
  const updatedBody = rewritePlanningText(body, {
    sourcePrNumber,
    planningPrNumber,
  });

  if (updatedBody === body) {
    return false;
  }

  const bodyFile = path.join(
    '.git',
    `planning-intake-repair-${planningPrNumber}.md`,
  );
  writeFile(bodyFile, updatedBody);
  runCommand(
    'gh',
    ['pr', 'edit', String(planningPrNumber), '--body-file', bodyFile],
    { capture: false },
  );
  return true;
}

function repairPlanningIntake({
  planningPrNumber,
  pr = null,
  runCommand = run,
  dryRun = false,
}) {
  const planningPr = pr ?? loadPlanningPr(planningPrNumber, runCommand);
  const errors = validatePlanningPr(planningPr);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  const sourcePrNumber = extractSourcePrNumber(planningPr.body);
  if (!Number.isFinite(sourcePrNumber)) {
    throw new Error(
      `PR #${planningPrNumber} body is missing Source PR metadata`,
    );
  }

  const quickPlanPath = extractQuickArtifactPath(planningPr, sourcePrNumber);
  if (!quickPlanPath) {
    throw new Error(
      `PR #${planningPrNumber} body is missing Quick artifact metadata`,
    );
  }
  const quickSummaryPath = quickSummaryPathFromPlan(quickPlanPath);
  const nonTargetQuickPaths = getNonTargetQuickPaths(planningPr, [
    quickPlanPath,
    quickSummaryPath,
  ]);

  if (dryRun) {
    return {
      dry_run: true,
      planning_pr_number: planningPrNumber,
      source_pr_number: sourcePrNumber,
      phase_namespace: `pr${sourcePrNumber}`,
      quick_artifact_path: quickPlanPath,
      quick_summary_path: quickSummaryPath,
      restored_paths: [...SHARED_PLANNING_PATHS, ...nonTargetQuickPaths],
    };
  }

  for (const filePath of [quickPlanPath, quickSummaryPath]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing quick artifact: ${filePath}`);
    }
  }
  const quickPlanContent = fs.readFileSync(quickPlanPath, 'utf8');
  const quickSummaryContent = fs.readFileSync(quickSummaryPath, 'utf8');

  const restoredPaths = restoreSharedPlanningPaths(
    planningPr.baseRefName,
    runCommand,
    nonTargetQuickPaths,
  );
  const changedPaths = rewriteQuickArtifacts({
    quickPlanPath,
    quickSummaryPath,
    quickPlanContent,
    quickSummaryContent,
    sourcePrNumber,
    planningPrNumber,
  });
  const bodyUpdated = updatePrBodyIfChanged({
    planningPrNumber,
    body: planningPr.body,
    sourcePrNumber,
    runCommand,
  });

  return {
    dry_run: false,
    planning_pr_number: planningPrNumber,
    source_pr_number: sourcePrNumber,
    phase_namespace: `pr${sourcePrNumber}`,
    quick_artifact_path: quickPlanPath,
    quick_summary_path: quickSummaryPath,
    changed_paths: changedPaths,
    restored_paths: restoredPaths,
    body_updated: bodyUpdated,
  };
}

function main() {
  const planningPrNumber = Number(getArg('--planning-pr-number'));
  const dryRun = getArg('--dry-run', 'false') === 'true';

  if (!Number.isFinite(planningPrNumber)) {
    throw new Error('--planning-pr-number must be numeric');
  }

  process.stdout.write(
    JSON.stringify(
      repairPlanningIntake({
        planningPrNumber,
        dryRun,
      }),
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  PLANNING_BRANCH_PREFIX,
  SHARED_PLANNING_PATHS,
  extractQuickArtifactPath,
  extractSourcePrNumber,
  getNamespaceCandidates,
  getNonTargetQuickPaths,
  main,
  quickSummaryPathFromPlan,
  repairPlanningIntake,
  restoreSharedPlanningPaths,
  rewritePlanningText,
  run,
  updatePrBodyIfChanged,
  validatePlanningPr,
};
