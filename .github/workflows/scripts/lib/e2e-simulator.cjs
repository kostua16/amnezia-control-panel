/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * E2E flow simulator — composes the workflow decision scripts along an event
 * sequence and returns the terminal decision. Shared harness for the e2e
 * characterization/spec tests in scripts/__tests__/e2e-*.test.cjs, which encode
 * docs/workflow-e2e-scenarios.md.
 *
 * The decision scripts are pure functions over fixtures, so the simulator calls
 * them directly — no process spawning, no GitHub API. See ADR 0001.
 */
const {
  evaluateFinalizerDecision,
} = require('../evaluate-pr-finalizer-decision.cjs');
const { getRequiredCheckStatus } = require('../required-check-evidence.cjs');

/** Base "trusted, ready-to-merge" finalizer policy. Override per case. */
function buildPolicy(overrides = {}) {
  return {
    eligible: true,
    manual_only: false,
    maintainer_approved: true,
    blocked_reason: '',
    same_repo: true,
    head_ref_name: 'feature/test',
    is_draft: false,
    blocking_labels_present: [],
    required_pass_labels: ['ai-review-passed'],
    labels: ['ai-review-passed'],
    ...overrides,
  };
}

/** Base non-draft, same-repo PR (normalized shape the decision fn expects). */
function buildPr(overrides = {}) {
  return {
    number: 1,
    state: 'OPEN',
    isDraft: false,
    headRefName: 'feature/test',
    headSha: 'abc123',
    baseRefName: 'main',
    labels: [],
    ...overrides,
  };
}

/** A check record shaped like the evidence-pipeline output. */
function buildCheck(name, { workflow, bucket, state } = {}) {
  return {
    name,
    workflow: workflow ?? name,
    bucket: bucket ?? 'pass',
    state: state ?? 'success',
  };
}

/**
 * §1 merge gate: aggregate required checks, then run the finalizer decision.
 * Returns the terminal decision + the computed check status.
 */
function mergeGateDecision({ policy, pr, checks = [], requiredChecks = [] }) {
  const checkStatus = getRequiredCheckStatus(checks, requiredChecks);
  const result = evaluateFinalizerDecision({
    policy: buildPolicy(policy),
    pr: buildPr(pr),
    checkStatus,
  });
  return { decision: result.decision, summary: result.summary, checkStatus };
}

module.exports = {
  buildPolicy,
  buildPr,
  buildCheck,
  mergeGateDecision,
};
