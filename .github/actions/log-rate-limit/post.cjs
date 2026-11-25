/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { logRateLimit } = require('./rate-limit.cjs');
const {
  formatUnavailableLine,
  reportRestCounter,
} = require('./rest-counter.cjs');

try {
  reportRestCounter();
} catch {
  try {
    const env = process.env;
    console.log(
      formatUnavailableLine({
        workflow: env.GITHUB_WORKFLOW,
        job: env.GITHUB_JOB,
        runId: env.GITHUB_RUN_ID,
        attempt: env.GITHUB_RUN_ATTEMPT,
        reason: 'report-failed',
      }),
    );
  } catch {
    // Reporting remains best effort if the log itself is unavailable.
  }
}
if (process.env['INPUT_REPORT-AT-JOB-END'] === 'true') {
  logRateLimit({ phase: 'job-end' });
}
