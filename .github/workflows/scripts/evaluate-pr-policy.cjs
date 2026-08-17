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

function startsWithAny(value, prefixes) {
  return (prefixes ?? []).some((prefix) => value.startsWith(prefix));
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

function normalizeFileDetails(pr, filesPayload) {
  const raw = filesPayload ?? pr.files ?? [];

  return raw
    .map((file) => {
      if (typeof file === 'string') {
        return {
          path: file,
          additions: 0,
          deletions: 0,
          changedLinesKnown: false,
        };
      }

      const rawAdditions = file.additions ?? file.added;
      const rawDeletions = file.deletions ?? file.deleted;
      const additions = Number(rawAdditions);
      const deletions = Number(rawDeletions);
      const pathValue = file.path ?? file.filename;

      return {
        path: pathValue,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
        changedLinesKnown:
          Number.isFinite(additions) && Number.isFinite(deletions),
      };
    })
    .filter((file) => file.path);
}

function normalizeFiles(pr, filesPayload) {
  return unique(
    normalizeFileDetails(pr, filesPayload).map((file) => file.path),
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

function summarizeSemverUpdateTypes(types) {
  const normalized = unique(
    types
      .map((value) =>
        String(value ?? '')
          .toLowerCase()
          .trim(),
      )
      .filter(Boolean),
  );

  if (normalized.length === 0) return 'unknown';
  if (normalized.includes('major')) return 'major';
  if (normalized.some((value) => !['patch', 'minor', 'same'].includes(value))) {
    return 'unknown';
  }
  if (normalized.includes('minor')) return 'minor';
  if (normalized.includes('patch')) return 'patch';
  if (normalized.every((value) => value === 'same')) return 'same';
  return 'unknown';
}

function parseDependabotUpdateTypesFromBody(body) {
  if (!body) return [];

  return [
    ...body.matchAll(
      /update-type:\s+version-update:semver-(major|minor|patch)\b/gi,
    ),
  ].map((match) => match[1].toLowerCase());
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
  const body = pr.body ?? '';
  const semverMatch = title.match(
    / from (\d+\.\d+\.\d+(?:[-+][^\s]+)?) to (\d+\.\d+\.\d+(?:[-+][^\s]+)?)/i,
  );
  let updateType = summarizeSemverUpdateTypes(
    parseDependabotUpdateTypesFromBody(body),
  );

  if (updateType === 'unknown' && semverMatch) {
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

function countChangedLines(file) {
  if (file.changedLinesKnown === false) return null;
  return file.additions + file.deletions;
}

function evaluateAuditSafePolicy(fileDetails, policy) {
  const auditSafe = policy.auditSafe ?? {};
  const allowedPathGlobs = auditSafe.allowedPathGlobs ?? [];
  const manualOnlyPathGlobs = [
    ...(policy.manualOnlyPathGlobs ?? []),
    ...(auditSafe.manualOnlyPathGlobs ?? []),
  ];
  // The findings ledger is a machine-generated data file that every audit-fix
  // run appends to; it is exempted by exact string equality (no globs) so it
  // can ride safe-lane audit PRs. An unset or misconfigured ledgerPath never
  // matches a real path, so the exemption fails closed.
  const ledgerPath =
    typeof auditSafe.ledgerPath === 'string' ? auditSafe.ledgerPath : '';
  const maxFiles = Number(auditSafe.maxFiles ?? 0);
  const maxChangedLines = Number(auditSafe.maxChangedLines ?? 0);
  const files = fileDetails.map((file) => file.path);
  const matchedManualPaths = files.filter(
    (file) => file !== ledgerPath && matchesAny(file, manualOnlyPathGlobs),
  );
  const disallowedPaths = files.filter(
    (file) => file !== ledgerPath && !matchesAny(file, allowedPathGlobs),
  );
  const unknownLinePaths = fileDetails
    .filter((file) => countChangedLines(file) === null)
    .map((file) => file.path);
  const totalChangedLines = fileDetails.reduce((sum, file) => {
    const changedLines = countChangedLines(file);
    return sum + (changedLines ?? 0);
  }, 0);

  let reason = null;

  if (fileDetails.length === 0) {
    reason = 'audit-safe changed files are unavailable';
  } else if (maxFiles > 0 && fileDetails.length > maxFiles) {
    reason = `audit-safe changed file count ${fileDetails.length} exceeds limit ${maxFiles}`;
  } else if (unknownLinePaths.length > 0) {
    reason = `audit-safe changed line counts unavailable for: ${unknownLinePaths.join(', ')}`;
  } else if (maxChangedLines > 0 && totalChangedLines > maxChangedLines) {
    reason = `audit-safe changed lines ${totalChangedLines} exceed limit ${maxChangedLines}`;
  } else if (matchedManualPaths.length > 0) {
    reason = `audit-safe diff touches manual-only paths: ${matchedManualPaths.join(', ')}`;
  } else if (disallowedPaths.length > 0) {
    reason = `audit-safe diff touches paths outside safe allow list: ${disallowedPaths.join(', ')}`;
  }

  return {
    eligible: reason === null,
    reason,
    changed_files_count: fileDetails.length,
    total_changed_lines: totalChangedLines,
    max_files: maxFiles,
    max_changed_lines: maxChangedLines,
    matched_manual_paths: matchedManualPaths,
    disallowed_paths: disallowedPaths,
    unknown_line_paths: unknownLinePaths,
  };
}

function evaluateGsdExecutionPolicy(fileDetails, policy) {
  const gsdExecution = policy.gsdExecution ?? {};
  const allowedPathGlobs = gsdExecution.safeAllowedPathGlobs ?? [];
  const manualOnlyPathGlobs = gsdExecution.manualOnlyPathGlobs ?? [];
  const maxFiles = Number(gsdExecution.maxFiles ?? 0);
  const maxChangedLines = Number(gsdExecution.maxChangedLines ?? 0);
  const files = fileDetails.map((file) => file.path);
  const matchedManualPaths = files.filter((file) =>
    matchesAny(file, manualOnlyPathGlobs),
  );
  const disallowedPaths = files.filter(
    (file) => !matchesAny(file, allowedPathGlobs),
  );
  const unknownLinePaths = fileDetails
    .filter((file) => countChangedLines(file) === null)
    .map((file) => file.path);
  const totalChangedLines = fileDetails.reduce((sum, file) => {
    const changedLines = countChangedLines(file);
    return sum + (changedLines ?? 0);
  }, 0);

  let reason = null;

  if (fileDetails.length === 0) {
    reason = 'gsd execution changed files are unavailable';
  } else if (maxFiles > 0 && fileDetails.length > maxFiles) {
    reason = `gsd execution changed file count ${fileDetails.length} exceeds limit ${maxFiles}`;
  } else if (unknownLinePaths.length > 0) {
    reason = `gsd execution changed line counts unavailable for: ${unknownLinePaths.join(', ')}`;
  } else if (maxChangedLines > 0 && totalChangedLines > maxChangedLines) {
    reason = `gsd execution changed lines ${totalChangedLines} exceed limit ${maxChangedLines}`;
  } else if (matchedManualPaths.length > 0) {
    reason = `gsd execution diff touches manual-only paths: ${matchedManualPaths.join(', ')}`;
  } else if (disallowedPaths.length > 0) {
    reason = `gsd execution diff touches paths outside safe allow list: ${disallowedPaths.join(', ')}`;
  }

  return {
    eligible: reason === null,
    reason,
    changed_files_count: fileDetails.length,
    total_changed_lines: totalChangedLines,
    max_files: maxFiles,
    max_changed_lines: maxChangedLines,
    matched_manual_paths: matchedManualPaths,
    disallowed_paths: disallowedPaths,
    unknown_line_paths: unknownLinePaths,
  };
}

function evaluateGeneratedStatePolicy(files, policy) {
  const generatedStatePathGlobs = policy.generatedStatePathGlobs ?? [];
  const matchedGeneratedStatePaths = files.filter((file) =>
    matchesAny(file, generatedStatePathGlobs),
  );
  const reason =
    matchedGeneratedStatePaths.length > 0
      ? `generated graphify state is a local cache and must not be committed: ${matchedGeneratedStatePaths.join(', ')}`
      : null;

  return {
    eligible: reason === null,
    reason,
    matched_generated_state_paths: matchedGeneratedStatePaths,
  };
}

function validatePolicy(policy) {
  validateSupportedGlobs(
    'manualOnlyPathGlobs',
    policy.manualOnlyPathGlobs ?? [],
  );
  validateSupportedGlobs(
    'generatedStatePathGlobs',
    policy.generatedStatePathGlobs ?? [],
  );
  validateSupportedGlobs(
    'improveQualifyingGlobs',
    policy.improveQualifyingGlobs ?? [],
  );

  if (policy.auditSafe) {
    validateSupportedGlobs(
      'auditSafe.allowedPathGlobs',
      policy.auditSafe.allowedPathGlobs ?? [],
    );
    validateSupportedGlobs(
      'auditSafe.manualOnlyPathGlobs',
      policy.auditSafe.manualOnlyPathGlobs ?? [],
    );
  }

  if (policy.trustedPlanning) {
    validateSupportedGlobs(
      'trustedPlanning.allowedPathGlobs',
      policy.trustedPlanning.allowedPathGlobs ?? [],
    );
  }

  if (policy.gsdExecution) {
    validateSupportedGlobs(
      'gsdExecution.safeAllowedPathGlobs',
      policy.gsdExecution.safeAllowedPathGlobs ?? [],
    );
    validateSupportedGlobs(
      'gsdExecution.manualOnlyPathGlobs',
      policy.gsdExecution.manualOnlyPathGlobs ?? [],
    );
  }
}

function evaluatePrPolicy(pr, policy, filesPayload = null) {
  validatePolicy(policy);

  const labels = normalizeLabels(pr);
  const maintainerApproved = labels.includes('maintainer-approved');
  const fileDetails = normalizeFileDetails(pr, filesPayload);
  const files = unique(fileDetails.map((file) => file.path));
  const headRefName = normalizeHeadRef(pr);
  const baseRefName = normalizeBaseRef(pr);
  const isDraft = Boolean(pr.isDraft ?? pr.draft);
  const isCrossRepository = normalizeIsCrossRepository(pr);
  const blockedLabels = labels.filter((label) =>
    policy.blockingLabels.includes(label),
  );
  const auditSafeConfig = policy.auditSafe ?? {};
  const isAuditSafeBranch =
    auditSafeConfig.safeBranchPrefix &&
    headRefName.startsWith(auditSafeConfig.safeBranchPrefix);
  // Same exact-path ledger exemption as evaluateAuditSafePolicy, applied to
  // the repo-wide manual-only globs so a safe-lane audit PR carrying only the
  // machine-generated findings ledger is not blocked by the .planning glob.
  // Scoped to audit-safe branches only; absent config fails closed.
  const auditLedgerPath =
    isAuditSafeBranch && typeof auditSafeConfig.ledgerPath === 'string'
      ? auditSafeConfig.ledgerPath
      : '';
  const matchedManualPaths = files.filter(
    (file) =>
      file !== auditLedgerPath && matchesAny(file, policy.manualOnlyPathGlobs),
  );
  const matchedImprovePaths = files.filter((file) =>
    matchesAny(file, policy.improveQualifyingGlobs),
  );
  const generatedStateEvaluation = evaluateGeneratedStatePolicy(files, policy);
  const dependabotUpdate = parseDependabotUpdate(pr, headRefName);
  const trustedPlanningConfig = policy.trustedPlanning ?? {};
  const trustedPlanningPrefixes = trustedPlanningConfig.branchPrefixes ?? [
    policy.planningBranchPrefix,
  ];
  const gsdExecutionConfig = policy.gsdExecution ?? {};
  const isTrustedPlanningBranch = startsWithAny(
    headRefName,
    trustedPlanningPrefixes,
  );
  const isPlanningBranch =
    isTrustedPlanningBranch ||
    headRefName.startsWith(policy.planningBranchPrefix);
  const isGsdExecutionBranch =
    gsdExecutionConfig.branchPrefix &&
    headRefName.startsWith(gsdExecutionConfig.branchPrefix);
  const isAuditManualBranch =
    auditSafeConfig.manualBranchPrefix &&
    headRefName.startsWith(auditSafeConfig.manualBranchPrefix);
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
  let auditSafeEvaluation = null;
  let gsdExecutionEvaluation = null;
  const trustedPlanningAllowed =
    files.length > 0 &&
    files.every((file) =>
      matchesAny(file, trustedPlanningConfig.allowedPathGlobs ?? []),
    );

  if (isTrustedPlanningBranch) {
    prClass = 'trusted-planning';
    requiredPassLabels = trustedPlanningConfig.requiredPassLabels ?? [
      'ai-review-passed',
      'security-review-passed',
    ];

    if (!trustedPlanningAllowed) {
      manualOnly = true;
      blockedReason =
        'trusted planning branch touched paths outside the planning allow list';
    }
  } else if (isPlanningBranch) {
    prClass = 'planning';
    manualOnly = true;
    blockedReason = 'planning branch is not in the trusted planning policy';
  } else if (isAuditSafeBranch) {
    prClass = 'audit-safe-fix';
    requiredPassLabels = ['ai-review-passed', 'security-review-passed'];
    auditSafeEvaluation = evaluateAuditSafePolicy(fileDetails, policy);

    if (!auditSafeEvaluation.eligible) {
      manualOnly = true;
      blockedReason = auditSafeEvaluation.reason;
    }
  } else if (isAuditManualBranch) {
    prClass = 'audit-manual-fix';
    manualOnly = true;
    blockedReason = 'audit-fix branches are manual-only by policy';
  } else if (isManualBranch) {
    prClass = 'workflow-manual';
    manualOnly = true;
    blockedReason = 'branch prefix is manual-only by policy';
  } else if (isGsdExecutionBranch) {
    prClass = 'gsd-planning-execution';
    requiredPassLabels = ['ai-review-passed', 'security-review-passed'];
    gsdExecutionEvaluation = evaluateGsdExecutionPolicy(fileDetails, policy);

    if (!gsdExecutionEvaluation.eligible) {
      manualOnly = true;
      blockedReason = gsdExecutionEvaluation.reason;
    }
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

  const hasManualPathExemption =
    (isTrustedPlanningBranch && trustedPlanningAllowed) ||
    (isGsdExecutionBranch && gsdExecutionEvaluation?.eligible);

  if (!manualOnly && !generatedStateEvaluation.eligible) {
    manualOnly = true;
    blockedReason = generatedStateEvaluation.reason;
  } else if (
    !manualOnly &&
    matchedManualPaths.length > 0 &&
    !hasManualPathExemption
  ) {
    manualOnly = true;
    blockedReason =
      'changed files include manual-only workflow or planning paths';
  }

  if (!manualOnly && blockedLabels.length > 0) {
    blockedReason = `blocking label present: ${blockedLabels.join(', ')}`;
  }

  if (
    maintainerApproved &&
    !dependabotUpdate &&
    requiredPassLabels.length === 0
  ) {
    requiredPassLabels = ['ai-review-passed', 'security-review-passed'];
  }

  const eligible =
    !isDraft &&
    !isCrossRepository &&
    !manualOnly &&
    blockedLabels.length === 0 &&
    (isTrustedAutomation ||
      Boolean(isAuditSafeBranch) ||
      (isTrustedPlanningBranch && trustedPlanningAllowed) ||
      (isGsdExecutionBranch && gsdExecutionEvaluation?.eligible) ||
      (dependabotUpdate && dependabotUpdate.supported));

  const shouldAnalyze =
    !isDraft &&
    !isPlanningBranch &&
    !skipImprove &&
    matchedImprovePaths.length > 0;

  return {
    eligible,
    pr_class: prClass,
    manual_only: manualOnly,
    blocked_reason: blockedReason,
    should_analyze: shouldAnalyze,
    same_repo: !isCrossRepository,
    is_draft: isDraft,
    head_ref_name: headRefName,
    base_ref_name: baseRefName,
    maintainerAssociations: policy.maintainerAssociations ?? [],
    maintainer_approved: maintainerApproved,
    required_pass_labels: requiredPassLabels,
    labels,
    blocking_labels_present: blockedLabels,
    matched_manual_paths: matchedManualPaths,
    matched_improve_paths: matchedImprovePaths,
    generated_state: generatedStateEvaluation,
    dependabot: dependabotUpdate,
    audit_safe: auditSafeEvaluation,
    gsd_execution: gsdExecutionEvaluation,
  };
}

function runCli() {
  const policyFile = getArg('--policy-file') ?? '.github/workflows/policy.json';
  const prFile = getArg('--pr-file');
  const filesFile = getArg('--files-file');

  if (!prFile) {
    throw new Error('--pr-file is required');
  }

  const policy = readJson(policyFile);
  const pr = readJson(prFile);
  const filesPayload = filesFile ? readJson(filesFile) : null;

  process.stdout.write(
    JSON.stringify(evaluatePrPolicy(pr, policy, filesPayload), null, 2),
  );
}

module.exports = {
  evaluateAuditSafePolicy,
  evaluateGsdExecutionPolicy,
  evaluateGeneratedStatePolicy,
  evaluatePrPolicy,
  getArg,
  globToRegExp,
  matchesAny,
  normalizeFileDetails,
  normalizeFiles,
  readJson,
  runCli,
  validatePolicy,
};

if (require.main === module) {
  runCli();
}
