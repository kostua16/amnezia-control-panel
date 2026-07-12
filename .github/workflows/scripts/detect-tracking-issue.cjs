/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Emits `is_tracking=true|false` for $GITHUB_OUTPUT based on the issue
// title/body/labels provided via environment variables. Used by workflows
// that must treat umbrella/tracking issues differently from fixable issues.

const { isTrackingIssue } = require('./lib/tracking-issue.cjs');

function detectFromEnv(env = process.env) {
  return isTrackingIssue({
    title: env.ISSUE_TITLE || '',
    body: env.ISSUE_BODY || '',
    labels: env.ISSUE_LABELS || '',
  });
}

function runCli() {
  const isTracking = detectFromEnv();
  process.stdout.write(`is_tracking=${isTracking ? 'true' : 'false'}\n`);
}

if (require.main === module) {
  runCli();
}

module.exports = { detectFromEnv };
