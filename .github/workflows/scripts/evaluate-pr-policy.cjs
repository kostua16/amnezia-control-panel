/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function readJson(filePath) {
  if (!filePath) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function validateSupportedGlobs(name, globs) {
  for (const glob of globs) {
    if (
      glob.startsWith('!') ||
      glob.includes('?') ||
      glob.includes('[') ||
      glob.includes(']')
    ) {
      throw new Error(
        `${name} contains unsupported glob "${glob}". Only literal paths plus * and ** are supported.`,
      );
    }
  }
}

function globToRegExp(glob) {
  // Keep workflow policy matching intentionally small: only `*` and `**` are supported.
  let regex = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];

    if (char === '*' && next === '*') {
      regex += '.*';
      index += 1;
      continue;
    }

    if (char === '*') {
      regex += '[^/]*';
      continue;
    }

    regex += escapeRegex(char);
  }

  regex += '$';
  return new RegExp(regex);
}

function matchesAny(pathValue, globs) {
  return globs.some((glob) => globToRegExp(glob).test(pathValue));
}

function normalizeLabels(pr) {
  const raw = pr.labels?.nodes ?? pr.labels ?? pr.labelNames ?? [];

  return unique(
    raw.map((label) => {
      if (typeof label === 'string') return label;
      return label.name;
    }),
  );
}

function normalizeFiles(pr, filesPayload) {
  const raw = filesPayload ?? pr.files ?? [];
  return unique(
    raw.map((file) => {
      if (typeof file === 'string') return file;
      return file.path ?? file.filename;
    }),
  );
}

function normalizeAuthorLogin(pr) {
  return pr.author?.login ?? pr.user?.login ?? pr.author_login ?? null;
}

function normalizeIsCrossRepository(pr) {
  if (typeof pr.isCrossRepository === 'boolean') {
    return pr.isCrossRepository;
  }

  if (pr.headRepository?.owner?.login && pr.baseRepository?.owner?.login) {
    return (
      pr.headRepository.owner.login !== pr.baseRepository.owner.login ||
      pr.headRepository.name !== pr.baseRepository.name
    );
  }

  if (pr.head?.repo?.full_name && pr.base?.repo?.full_name) {
    return pr.head.repo.full_name !== pr.base.repo.full_name;
  }

  return false;
}

function normalizeHeadRef(pr) {
  return pr.headRefName ?? pr.head?.ref ?? '';
}

function normalizeBaseRef(pr) {
  return pr.baseRefName ?? pr.base?.ref ?? '';
}

function normalizeEcosystemName(value) {
  return String(value ?? 'unknown').replace(/-/g, '_');
}

function parseDependabotUpdate(pr, headRefName) {
  const authorLogin = normalizeAuthorLogin(pr);
  const isDependabot =
    authorLogin === 'dependabot[bot]' || headRefName.startsWith('dependabot/');

  if (!isDependabot) {
    return null;
  }

  const [, rawEcosystem = 'unknown'] = headRefName.split('/');
  const ecosystem = normalizeEcosystemName(rawEcosystem);
  const title = pr.title ?? '';
  const semverMatch = title.match(
    / from (\d+\.\d+\.\d+(?:[-+][^\s]+)?) to (\d+\.\d+\.\d+(?:[-+][^\s]+)?)/i,
  );
  let updateType = 'unknown';

  if (semverMatch) {
    const from = semverMatch[1].split(/[+-]/)[0].split('.').map(Number);
    const to = semverMatch[2].split(/[+-]/)[0].split('.').map(Number);

    if (
      from.length === 3 &&
      to.length === 3 &&
      from.every(Number.isFinite) &&
      to.every(Number.isFinite)
    ) {
      if (to[0] !== from[0]) {
        updateType = 'major';
      } else if (to[1] !== from[1]) {
        updateType = 'minor';
      } else if (to[2] !== from[2]) {
        updateType = 'patch';
      } else {
        updateType = 'same';
      }
    }
  }

  return {
    ecosystem,
    updateType,
    supported: ['patch', 'minor'].includes(updateType),
  };
}

const policyFile = getArg('--policy-file') ?? '.github/workflows/policy.json';
const prFile = getArg('--pr-file');
const filesFile = getArg('--files-file');

if (!prFile) {
  throw new Error('--pr-file is required');
}

const policy = readJson(policyFile);
const pr = readJson(prFile);
const filesPayload = filesFile ? readJson(filesFile) : null;

validateSupportedGlobs('manualOnlyPathGlobs', policy.manualOnlyPathGlobs ?? []);
validateSupportedGlobs(
  'improveQualifyingGlobs',
  policy.improveQualifyingGlobs ?? [],
);

const labels = normalizeLabels(pr);
const files = normalizeFiles(pr, filesPayload);
const headRefName = normalizeHeadRef(pr);
const baseRefName = normalizeBaseRef(pr);
const isDraft = Boolean(pr.isDraft ?? pr.draft);
const isCrossRepository = normalizeIsCrossRepository(pr);
const blockedLabels = labels.filter((label) =>
  policy.blockingLabels.includes(label),
);
const matchedManualPaths = files.filter((file) =>
  matchesAny(file, policy.manualOnlyPathGlobs),
);
const matchedImprovePaths = files.filter((file) =>
  matchesAny(file, policy.improveQualifyingGlobs),
);
const dependabotUpdate = parseDependabotUpdate(pr, headRefName);
const isPlanningBranch = headRefName.startsWith(policy.planningBranchPrefix);
const isTrustedAutomation = policy.trustedAutomationBranchPrefixes.some(
  (prefix) => headRefName.startsWith(prefix),
);
const isManualBranch = policy.manualOnlyBranchPrefixes.some((prefix) =>
  headRefName.startsWith(prefix),
);
const skipImprove = labels.some((label) =>
  policy.improveSkipLabels.includes(label),
);

let prClass = 'other';
let manualOnly = false;
let blockedReason = null;
let requiredPassLabels = [];

if (isPlanningBranch) {
  prClass = 'planning';
  manualOnly = true;
  blockedReason = 'planning branches are always human-reviewed';
} else if (isManualBranch) {
  prClass = 'workflow-manual';
  manualOnly = true;
  blockedReason = 'branch prefix is manual-only by policy';
} else if (isTrustedAutomation) {
  prClass = 'automation-fix';
  requiredPassLabels = ['ai-review-passed', 'security-review-passed'];
} else if (dependabotUpdate) {
  const disallowedPrefix = policy.dependabot.manualOnlyBranchPrefixes.some(
    (prefix) => headRefName.startsWith(prefix),
  );
  const allowedEcosystem = (policy.dependabot.allowedEcosystems ?? [])
    .map(normalizeEcosystemName)
    .includes(dependabotUpdate.ecosystem);

  prClass = 'dependabot';
  requiredPassLabels = ['deps-review-passed'];

  if (disallowedPrefix) {
    manualOnly = true;
    blockedReason = 'dependabot GitHub Actions updates stay manual-only';
  } else if (!allowedEcosystem) {
    manualOnly = true;
    blockedReason = `dependabot ecosystem "${dependabotUpdate.ecosystem}" is not in the auto-approve allow list`;
  } else if (!dependabotUpdate.supported) {
    manualOnly = true;
    blockedReason =
      dependabotUpdate.updateType === 'major'
        ? 'dependabot major updates stay manual-only'
        : 'dependabot update type could not be proven as patch/minor';
  }
}

if (!manualOnly && matchedManualPaths.length > 0) {
  manualOnly = true;
  blockedReason =
    'changed files include manual-only workflow or planning paths';
}

if (!manualOnly && blockedLabels.length > 0) {
  blockedReason = `blocking label present: ${blockedLabels.join(', ')}`;
}

const eligible =
  !isDraft &&
  !isCrossRepository &&
  !manualOnly &&
  blockedLabels.length === 0 &&
  (isTrustedAutomation || (dependabotUpdate && dependabotUpdate.supported));

const shouldAnalyze =
  !isDraft &&
  !isPlanningBranch &&
  !skipImprove &&
  matchedImprovePaths.length > 0;

process.stdout.write(
  JSON.stringify(
    {
      eligible,
      pr_class: prClass,
      manual_only: manualOnly,
      blocked_reason: blockedReason,
      should_analyze: shouldAnalyze,
      same_repo: !isCrossRepository,
      is_draft: isDraft,
      head_ref_name: headRefName,
      base_ref_name: baseRefName,
      required_pass_labels: requiredPassLabels,
      labels,
      blocking_labels_present: blockedLabels,
      matched_manual_paths: matchedManualPaths,
      matched_improve_paths: matchedImprovePaths,
      dependabot: dependabotUpdate,
    },
    null,
    2,
  ),
);
