/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const { collectCheckEvidence } = require('./required-check-evidence.cjs');

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeLabels(labels) {
  return (labels ?? []).map((label) =>
    typeof label === 'string' ? label : label.name,
  );
}

function normalizePr(pr) {
  return {
    number: pr.number,
    state: pr.state ?? '',
    mergedAt: pr.mergedAt ?? '',
    isDraft: Boolean(pr.isDraft),
    headRefName: pr.headRefName ?? '',
    headSha: pr.headRefOid ?? pr.headSha ?? '',
    baseRefName: pr.baseRefName ?? 'main',
    labels: normalizeLabels(pr.labels),
  };
}

function joinLabels(labels) {
  return labels.join(', ');
}

function splitBlockingLabels(labels) {
  const hard = [];
  const manualReview = [];

  for (const label of labels ?? []) {
    if (label === 'needs-review') {
      manualReview.push(label);
    } else {
      hard.push(label);
    }
  }

  return { hard, manualReview };
}

function missingRequiredLabels(policy) {
  const requiredLabels = policy.required_pass_labels ?? [];
  const presentLabels = policy.labels ?? [];
  return requiredLabels.filter((label) => !presentLabels.includes(label));
}

function evaluateFinalizerDecision({ policy, pr, checkStatus }) {
  const policyEligible = Boolean(policy.eligible);
  const manualOnly = Boolean(policy.manual_only);
  const maintainerApproved = Boolean(policy.maintainer_approved);
  const blockedReason = policy.blocked_reason ?? '';
  const sameRepo = Boolean(policy.same_repo);
  const headRef = policy.head_ref_name ?? pr.headRefName ?? '';
  const isDraft = Boolean(policy.is_draft ?? pr.isDraft);
  const { hard: hardBlockingLabels, manualReview: manualReviewLabels } =
    splitBlockingLabels(policy.blocking_labels_present ?? []);
  const missingLabels = missingRequiredLabels(policy);

  if (isDraft) {
    return {
      decision: 'awaiting_checks',
      summary: 'PR is still draft.',
    };
  }

  if (hardBlockingLabels.length > 0) {
    return {
      decision: 'blocked',
      summary: `Blocking labels are present: ${joinLabels(hardBlockingLabels)}`,
    };
  }

  if (!maintainerApproved && manualReviewLabels.length > 0) {
    return {
      decision: 'manual_only',
      summary: `Manual review is required by label: ${joinLabels(manualReviewLabels)}`,
    };
  }

  if (!headRef) {
    return {
      decision: 'blocked',
      summary: 'PR metadata is incomplete; skipping auto-finalization.',
    };
  }

  if (!maintainerApproved && manualOnly) {
    return {
      decision: 'manual_only',
      summary: blockedReason || 'PR is manual-only by policy.',
    };
  }

  if (!sameRepo) {
    return {
      decision: 'manual_only',
      summary: blockedReason || 'PR is outside the same-repo trusted scope.',
    };
  }

  if (!policyEligible && !maintainerApproved) {
    return {
      decision: 'manual_only',
      summary:
        blockedReason ||
        'PR needs maintainer approval or a trusted auto-finalization policy.',
    };
  }

  if (missingLabels.length > 0) {
    return {
      decision: 'awaiting_checks',
      summary: `Waiting on review signals: ${joinLabels(missingLabels)}`,
    };
  }

  if (checkStatus.status === 'failed') {
    return {
      decision: 'blocked',
      summary: `Required checks are failing: ${joinLabels(checkStatus.failing)}`,
    };
  }

  if (checkStatus.status === 'unavailable') {
    return {
      decision: 'blocked',
      summary:
        checkStatus.reason ||
        'Required checks could not be read and no workflow-run fallback was available.',
    };
  }

  if (checkStatus.status === 'pending') {
    const waitingOn = [...checkStatus.pending, ...checkStatus.missing].filter(
      Boolean,
    );
    return {
      decision: 'awaiting_checks',
      summary:
        waitingOn.length > 0
          ? `Waiting for required checks to finish: ${joinLabels(waitingOn)}`
          : 'Waiting for required checks to finish.',
    };
  }

  if (checkStatus.status === 'passed') {
    return {
      decision: 'approve_and_enable_automerge',
      summary: 'Trusted PR passed required checks and review signals.',
    };
  }

  return {
    decision: 'blocked',
    summary: `Unknown required-check status: ${checkStatus.status}`,
  };
}

function main() {
  const configFile = getArg('--config-file', '.github/pr-flow.json');
  const eventName = getArg('--event-name', process.env.GITHUB_EVENT_NAME ?? '');
  const eventPath = getArg('--event-path', process.env.GITHUB_EVENT_PATH ?? '');
  const policyFile = getArg('--policy-file');
  const prFile = getArg('--pr-file');
  const dryRun = getArg('--dry-run', process.env.DRY_RUN ?? 'false');

  if (!policyFile || !prFile) {
    throw new Error('--policy-file and --pr-file are required.');
  }

  const config = readJson(configFile);
  const event =
    eventPath && fs.existsSync(eventPath) ? readJson(eventPath) : {};
  const policy = readJson(policyFile);
  const pr = normalizePr(readJson(prFile));
  const evidence = collectCheckEvidence({
    pr,
    config,
    eventName,
    event,
    allowRunListFallback: true,
  });
  const finalizer = evaluateFinalizerDecision({
    policy,
    pr,
    checkStatus: evidence.checkStatus,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ...finalizer,
        dry_run: dryRun,
        check_status: evidence.checkStatus,
        check_source: evidence.source,
        check_source_reason: evidence.reason,
        checks: evidence.checks,
      },
      null,
      2,
    )}\n`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateFinalizerDecision,
  missingRequiredLabels,
  normalizePr,
  splitBlockingLabels,
};
