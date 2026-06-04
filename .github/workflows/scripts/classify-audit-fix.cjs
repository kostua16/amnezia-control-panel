/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('child_process');
const fs = require('fs');
const {
  evaluateAuditSafePolicy,
  getArg,
  readJson,
} = require('./evaluate-pr-policy.cjs');
const { buildAutomationPrBody } = require('./build-automation-pr-body.cjs');

function runGit(args) {
  return (execFileSync('git', args, { encoding: 'utf8' }) ?? '').trim();
}

function parseNumstat(output) {
  if (!output) return [];

  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [rawAdditions, rawDeletions, ...pathParts] = line.split('\t');
      const additions = Number(rawAdditions);
      const deletions = Number(rawDeletions);
      const path = pathParts.join('\t');

      return {
        path,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
        changedLinesKnown:
          Number.isFinite(additions) && Number.isFinite(deletions),
      };
    });
}

function countFileLines(filePath) {
  const content = fs.readFileSync(filePath);
  if (content.length === 0) return 0;

  let lines = 0;
  for (const byte of content) {
    if (byte === 10) lines += 1;
  }

  return content[content.length - 1] === 10 ? lines : lines + 1;
}

function collectGitDiff() {
  const tracked = parseNumstat(runGit(['diff', '--numstat']));
  const seen = new Set(tracked.map((file) => file.path));
  const untrackedOutput = runGit([
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  const untracked = untrackedOutput
    ? untrackedOutput
        .split('\n')
        .filter(Boolean)
        .filter((filePath) => !seen.has(filePath))
        .map((filePath) => ({
          path: filePath,
          additions: countFileLines(filePath),
          deletions: 0,
          changedLinesKnown: true,
        }))
    : [];

  return [...tracked, ...untracked];
}

function buildBody({ eligible, reason, runId, fileDetails }) {
  const lane = eligible ? 'safe auto-merge candidate' : 'manual review';
  const files = fileDetails.map((file) => file.path).join('\n');
  const reviewNotes = eligible
    ? 'This PR matched the audit-safe policy and may be auto-merged after CI, AI review, and security review pass.'
    : `This PR is intentionally manual-only under repository policy. Reason: ${reason}.`;

  return buildAutomationPrBody({
    workflowName: 'audit-fix',
    problem:
      'Autonomous audit-fix found audit findings and produced reviewable changes.',
    trigger: `Audit fix run ID: ${runId}`,
    rationale: `Classification: ${lane}. Policy reason: ${reason}.`,
    changedFiles: files,
    evidence: [
      `Run ID: ${runId}`,
      `Classification: ${lane}`,
      `Reason: ${reason}`,
    ].join('\n'),
    reviewNotes,
  });
}

function classifyAuditFix({ mode, policy, runId, fileDetails }) {
  const auditSafe = policy.auditSafe ?? {};
  const manualPrefix = auditSafe.manualBranchPrefix ?? 'claude-audit-fix-';
  const safePrefix = auditSafe.safeBranchPrefix ?? 'claude-audit-safe-fix-';
  const safeLabels = auditSafe.safeLabels ?? [
    'auto-fix',
    'audit-safe',
    'skip-improve',
  ];
  const manualLabels = auditSafe.manualLabels ?? ['auto-fix', 'needs-review'];
  const safeEvaluation = evaluateAuditSafePolicy(fileDetails, policy);
  const hasChanges = fileDetails.length > 0;
  const requestedManual = mode === 'manual-only';
  const eligible = hasChanges && !requestedManual && safeEvaluation.eligible;
  const reason = !hasChanges
    ? 'no changes'
    : requestedManual
      ? 'manual-only mode requested'
      : (safeEvaluation.reason ?? 'matched audit-safe policy');
  const branchPrefix = eligible ? safePrefix : manualPrefix;
  const labels = eligible ? safeLabels : manualLabels;

  return {
    eligible,
    reason,
    branch_name: `${branchPrefix}${runId}`,
    draft: eligible ? 'false' : 'true',
    labels: labels.join(','),
    title: 'fix(audit): address autonomous audit findings',
    body: buildBody({ eligible, reason, runId, fileDetails }),
    audit_safe: safeEvaluation,
  };
}

function runCli() {
  const policyFile = getArg('--policy-file') ?? '.github/workflows/policy.json';
  const mode = getArg('--mode') ?? 'auto';
  const runId = getArg('--run-id') ?? process.env.GITHUB_RUN_ID ?? 'local';
  const policy = readJson(policyFile);

  try {
    process.stdout.write(
      JSON.stringify(
        classifyAuditFix({
          mode,
          policy,
          runId,
          fileDetails: collectGitDiff(),
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    const fallbackPolicy = policy ?? {};
    const auditSafe = fallbackPolicy.auditSafe ?? {};
    const manualPrefix = auditSafe.manualBranchPrefix ?? 'claude-audit-fix-';
    const reason = error instanceof Error ? error.message : String(error);

    process.stdout.write(
      JSON.stringify(
        {
          eligible: false,
          reason: `classifier failed: ${reason}`,
          branch_name: `${manualPrefix}${runId}`,
          draft: 'true',
          labels: (auditSafe.manualLabels ?? ['auto-fix', 'needs-review']).join(
            ',',
          ),
          title: 'fix(audit): address autonomous audit findings',
          body: buildBody({
            eligible: false,
            reason: `classifier failed: ${reason}`,
            runId,
            fileDetails: [],
          }),
        },
        null,
        2,
      ),
    );
  }
}

module.exports = {
  buildBody,
  classifyAuditFix,
  collectGitDiff,
  countFileLines,
  parseNumstat,
  runCli,
};

if (require.main === module) {
  runCli();
}
