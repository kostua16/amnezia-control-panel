/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { logRateLimit } = require('./rate-limit.cjs');
const { reportRestCounter } = require('./rest-counter.cjs');

try {
  reportRestCounter();
} catch {
  try {
    const env = process.env;
    const workflow = JSON.stringify(env.GITHUB_WORKFLOW ?? '');
    const job = env.GITHUB_JOB ?? '';
    const run = `${env.GITHUB_RUN_ID ?? ''}.${env.GITHUB_RUN_ATTEMPT ?? ''}`;
    console.log(
      `REST_COUNT workflow=${workflow} job=${job} run=${run} status=unavailable reason=report-failed total=0 graphql=0 by_route={}`,
    );
  } catch {
    // Reporting remains best effort if the log itself is unavailable.
  }
}
if (process.env['INPUT_REPORT-AT-JOB-END'] === 'true') {
  logRateLimit({ phase: 'job-end' });
}
