/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_QUICK_DIR = '.planning/quick';
const DEFAULT_QUEUE_DIR = '.planning/phases/999-gh-planning-execution-queue';
const SOURCE_HASH_MARKER = '<!-- gsd-planning-source-sha256:';

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function toBoolean(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function toPosixPath(value) {
  return String(value ?? '')
    .split(path.sep)
    .join('/');
}

function normalizeRepoPath(value) {
  return toPosixPath(value).replace(/^\.\//, '');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function isPlanningArtifact(filePath) {
  const basename = path.basename(filePath);
  if (/summary\.md$/i.test(basename)) return false;
  if (/^proposal\.md$/i.test(basename)) return true;
  return /(?:^|[-_])plan\.md$/i.test(basename);
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function firstMarkdownHeading(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function titleFromPath(filePath) {
  const parent = path.basename(path.dirname(filePath));
  return parent
    .replace(/^\d{6}-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractSourcePr(content, filePath) {
  const text = `${filePath}\n${content}`;
  const match = text.match(/\bPR\s*#?(\d+)\b/i) ?? text.match(/\bpr(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function extractDateKey(filePath) {
  const match = normalizeRepoPath(filePath).match(/\b(\d{6})\b/);
  return match ? match[1] : '999999';
}

function severityRank(content) {
  if (/\bcritical\b/i.test(content)) return 4;
  if (/\bhigh\b/i.test(content)) return 3;
  if (/\bmedium\b/i.test(content)) return 2;
  if (/\blow\b/i.test(content)) return 1;
  return 0;
}

function collectCandidates({ quickDir = DEFAULT_QUICK_DIR } = {}) {
  return walkFiles(quickDir)
    .filter(isPlanningArtifact)
    .map((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      const repoPath = normalizeRepoPath(filePath);
      return {
        path: repoPath,
        hash: sha256(content),
        title: firstMarkdownHeading(content) ?? titleFromPath(filePath),
        source_pr: extractSourcePr(content, repoPath),
        date_key: extractDateKey(repoPath),
        severity_rank: severityRank(content),
      };
    })
    .sort((left, right) => {
      if (right.severity_rank !== left.severity_rank) {
        return right.severity_rank - left.severity_rank;
      }
      if (left.date_key !== right.date_key) {
        return left.date_key.localeCompare(right.date_key);
      }
      return left.path.localeCompare(right.path);
    });
}

function collectImportedSources(queueDir = DEFAULT_QUEUE_DIR) {
  const imported = {
    hashes: new Set(),
    paths: new Set(),
    maxPlanNumber: 0,
    maxWave: 0,
  };

  for (const filePath of walkFiles(queueDir).filter((candidate) =>
    /(?:^|[-_])plan\.md$/i.test(path.basename(candidate)),
  )) {
    const content = fs.readFileSync(filePath, 'utf8');
    const hashMatch = content.match(
      /^source_artifact_sha256:\s*"?([a-f0-9]+)"?\s*$/im,
    );
    const pathMatch = content.match(/^source_artifact:\s*"?([^"\n]+)"?\s*$/im);
    const waveMatch = content.match(/^wave:\s*"?(\d+)"?\s*$/im);
    const planMatch = path.basename(filePath).match(/^999-(\d+)-PLAN\.md$/i);

    if (hashMatch) imported.hashes.add(hashMatch[1]);
    if (pathMatch) imported.paths.add(normalizeRepoPath(pathMatch[1]));
    if (waveMatch) {
      imported.maxWave = Math.max(imported.maxWave, Number(waveMatch[1]));
    }
    if (planMatch) {
      imported.maxPlanNumber = Math.max(
        imported.maxPlanNumber,
        Number(planMatch[1]),
      );
    }
  }

  return imported;
}

function collectOpenExecutionHashes(openPrsFile) {
  if (!openPrsFile || !fs.existsSync(openPrsFile)) return new Set();

  const rows = JSON.parse(fs.readFileSync(openPrsFile, 'utf8'));
  const hashes = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const body = String(row.body ?? '');
    const markerPattern = new RegExp(
      `${SOURCE_HASH_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*([a-f0-9]+)\\s*-->`,
      'gi',
    );
    for (const match of body.matchAll(markerPattern)) {
      hashes.add(match[1]);
    }
  }

  return hashes;
}

function collectOpenExecutionPlanSlots(openPrsFile) {
  if (!openPrsFile || !fs.existsSync(openPrsFile)) return new Set();

  const rows = JSON.parse(fs.readFileSync(openPrsFile, 'utf8'));
  const slots = new Set();
  // The "Imported plan:" marker emitted by build-automation-pr-body records the
  // queue slot each open execution PR occupies. Reserve those plan numbers so a
  // concurrent run (whose checkout of main does not yet contain the unmerged
  // plan file) does not re-assign the same 999-NNN slot and collide on the file.
  const markerPattern = /Imported plan:\s*[`'"]?([^\s`'"]+)/gi;

  for (const row of Array.isArray(rows) ? rows : []) {
    const body = String(row.body ?? '');
    for (const markerMatch of body.matchAll(markerPattern)) {
      const slotMatch = markerMatch[1].match(/\b999-(\d+)-PLAN\.md\b/i);
      if (slotMatch) slots.add(Number(slotMatch[1]));
    }
  }

  return slots;
}

function selectCandidates({
  candidates,
  imported,
  openHashes = new Set(),
  candidatePath = '',
  maxPlans = 1,
}) {
  const normalizedCandidatePath = candidatePath
    ? normalizeRepoPath(candidatePath)
    : '';
  const selected = [];
  const skipped = [];

  for (const candidate of candidates) {
    if (
      normalizedCandidatePath &&
      normalizeRepoPath(candidate.path) !== normalizedCandidatePath
    ) {
      continue;
    }

    if (imported.hashes.has(candidate.hash)) {
      skipped.push({ ...candidate, reason: 'already-imported-hash' });
      continue;
    }

    if (imported.paths.has(candidate.path)) {
      skipped.push({ ...candidate, reason: 'already-imported-path' });
      continue;
    }

    if (openHashes.has(candidate.hash)) {
      skipped.push({ ...candidate, reason: 'open-execution-pr' });
      continue;
    }

    selected.push(candidate);
    if (selected.length >= maxPlans) break;
  }

  return { selected, skipped };
}

function yamlQuote(value) {
  return JSON.stringify(String(value ?? ''));
}

function renderPlan({
  candidate,
  planNumber,
  wave,
  queueDir = DEFAULT_QUEUE_DIR,
}) {
  const planId = `999-${String(planNumber).padStart(3, '0')}`;
  const sourcePr = candidate.source_pr
    ? String(candidate.source_pr)
    : 'unknown';
  const sourceContent = fs.readFileSync(candidate.path, 'utf8').trimEnd();

  return `${[
    '---',
    'phase: 999',
    `plan: ${planId}`,
    'type: execute',
    `wave: ${wave}`,
    'depends_on: []',
    'files_modified: []',
    'autonomous: true',
    `source_artifact: ${yamlQuote(candidate.path)}`,
    `source_artifact_sha256: ${candidate.hash}`,
    `source_pr: ${yamlQuote(sourcePr)}`,
    'must_haves:',
    '  truths:',
    '    - "Use the merged source artifact as the implementation specification."',
    '    - "Keep implementation changes scoped and reviewable."',
    '  artifacts:',
    `    - path: ${yamlQuote(candidate.path)}`,
    '      provides: "Merged planning artifact selected from main."',
    '  key_links:',
    `    - ${yamlQuote(candidate.path)}`,
    '---',
    '',
    `# Plan ${planId}: ${candidate.title}`,
    '',
    '## Source',
    `- Artifact: \`${candidate.path}\``,
    `- SHA-256: \`${candidate.hash}\``,
    `- Source PR: ${candidate.source_pr ? `#${candidate.source_pr}` : 'unknown'}`,
    `- Queue: \`${normalizeRepoPath(queueDir)}\``,
    '',
    '## Goal',
    'Execute the merged planning artifact as a concrete repository change.',
    '',
    '## Implementation Instructions',
    '- Read the source artifact before editing code.',
    '- Translate the artifact into the smallest useful implementation.',
    '- Keep changes within the artifact intent; leave unrelated refactors alone.',
    '- Add or update tests when behavior changes.',
    '- Do not commit, push, merge, or open pull requests; workflow automation handles Git operations.',
    '',
    '## Acceptance Criteria',
    '- The implementation addresses the selected planning artifact.',
    '- Relevant tests, linting, and formatting checks pass or any blockers are documented in the PR body.',
    '- The resulting PR remains reviewable and can be risk-classified by workflow policy.',
    '',
    '## Source Artifact Snapshot',
    '',
    '```markdown',
    sourceContent,
    '```',
    '',
  ].join('\n')}`;
}

function writeSelectedPlans({
  selected,
  imported,
  queueDir = DEFAULT_QUEUE_DIR,
  reservedPlanNumbers = new Set(),
}) {
  ensureDir(queueDir);
  // maxPlanNumber reflects only plan files already on main. Slots claimed by
  // open execution PRs are absent from that checkout, so hand out the first
  // free numbers that skip every reserved slot instead of counting up blindly.
  const reserved = new Set(reservedPlanNumbers);
  let nextPlanNumber = imported.maxPlanNumber + 1;
  return selected.map((candidate, index) => {
    while (reserved.has(nextPlanNumber)) nextPlanNumber += 1;
    const planNumber = nextPlanNumber;
    reserved.add(planNumber);
    nextPlanNumber += 1;
    const wave = imported.maxWave + index + 1;
    const planPath = path.join(
      queueDir,
      `999-${String(planNumber).padStart(3, '0')}-PLAN.md`,
    );
    fs.writeFileSync(
      planPath,
      renderPlan({ candidate, planNumber, wave, queueDir }),
    );
    return {
      ...candidate,
      plan_path: normalizeRepoPath(planPath),
      plan: `999-${String(planNumber).padStart(3, '0')}`,
      wave,
    };
  });
}

function runCollector(options = {}) {
  const quickDir = options.quickDir ?? DEFAULT_QUICK_DIR;
  const queueDir = options.queueDir ?? DEFAULT_QUEUE_DIR;
  const maxPlans = Math.max(1, Number(options.maxPlans ?? 1));
  const candidates = collectCandidates({ quickDir });
  const imported = collectImportedSources(queueDir);
  const openHashes = collectOpenExecutionHashes(options.openPrsFile);
  const openPlanSlots = collectOpenExecutionPlanSlots(options.openPrsFile);
  const selection = selectCandidates({
    candidates,
    imported,
    openHashes,
    candidatePath: options.candidatePath ?? '',
    maxPlans,
  });
  const importedPlans = options.write
    ? writeSelectedPlans({
        selected: selection.selected,
        imported,
        queueDir,
        reservedPlanNumbers: openPlanSlots,
      })
    : selection.selected;

  return {
    has_candidate: importedPlans.length > 0,
    selected_count: importedPlans.length,
    candidate_count: candidates.length,
    selected: importedPlans,
    skipped: selection.skipped,
  };
}

function main() {
  const result = runCollector({
    quickDir: getArg('--quick-dir', DEFAULT_QUICK_DIR),
    queueDir: getArg('--queue-dir', DEFAULT_QUEUE_DIR),
    maxPlans: getArg('--max-plans', '1'),
    candidatePath: getArg('--candidate-path', ''),
    openPrsFile: getArg('--open-prs-file', ''),
    write: toBoolean(getArg('--write', 'false')),
  });

  process.stdout.write(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_QUEUE_DIR,
  DEFAULT_QUICK_DIR,
  SOURCE_HASH_MARKER,
  collectCandidates,
  collectImportedSources,
  collectOpenExecutionHashes,
  collectOpenExecutionPlanSlots,
  isPlanningArtifact,
  renderPlan,
  runCollector,
  selectCandidates,
  sha256,
  writeSelectedPlans,
};
