/* eslint-disable @typescript-eslint/no-require-imports */
// Shared renderer for the dual-block gate summary used by the code-pushing
// claude-driven workflows (fix-review, audit-fix, fix-issue, _auto-fix-ci,
// monitor, workflow-health-optimize). Renders BOTH the agent's self-reported
// validation (labelled "may be inaccurate") AND the workflow gate's real
// per-check outcomes (labelled "authoritative"), behind a banner stating that
// only the workflow gate decides whether a push happens.
//
// Why: on PR #472 the agent self-reported every check as "pass" while the real
// gate failed (the .claude-pr/ runtime artifact tripped lint), and the summary
// printed the agent's all-pass block under a "validation failed" header — a
// flat contradiction. Showing both turns the gap into a visible delta, while
// keeping the gate as the sole authority for the push verdict.
// See docs/adr/0002-pre-push-gate-for-claude-driven-workflows.md.

const BANNER =
  '⚠️ Agent self-reported checks can be inaccurate. The Workflow gate below ' +
  'is the final gatekeeper — only a green gate allows a push.';

// Normalize a GitHub Actions step outcome to a short label.
// 'success' -> 'pass', 'failure' -> 'fail', 'skipped'/'unknown' -> kept as-is.
function label(outcome) {
  if (outcome === 'success') return 'pass';
  if (outcome === 'failure') return 'fail';
  return outcome || 'unknown';
}

// gateOutcomes: { lint, test, build, scriptTests, prismaSafe } — each a GitHub
//   step outcome ('success' | 'failure' | 'skipped') from validate-pr-gate.
// agentValidation: optional { tsc, lint, tests, format, build } from the
//   agent's structured output (omitted entirely when the sibling emits none).
function renderGateSummary({ agentValidation = {}, gateOutcomes = {} } = {}) {
  const lines = [BANNER, ''];

  const agentKeys = ['tsc', 'lint', 'tests', 'format', 'build'].filter(
    (k) => agentValidation[k],
  );
  if (agentKeys.length > 0) {
    lines.push('Agent-reported (may be inaccurate):');
    agentKeys.forEach((k) => lines.push(`- ${k}: **${agentValidation[k]}**`));
    lines.push('');
  }

  lines.push('Workflow gate (authoritative):');
  const rows = [
    ['lint (tracked files)', gateOutcomes.lint],
    ['typecheck', gateOutcomes.typecheck],
    ['format (prettier)', gateOutcomes.format],
    ['unit tests', gateOutcomes.test],
    ['build', gateOutcomes.build],
    ['workflow script e2e-tests', gateOutcomes.scriptTests],
    ['prisma-safe-sql', gateOutcomes.prismaSafe],
  ];
  rows.forEach(([name, outcome]) => {
    lines.push(`- ${name}: **${label(outcome)}**`);
  });

  return lines.join('\n');
}

module.exports = { BANNER, label, renderGateSummary };
