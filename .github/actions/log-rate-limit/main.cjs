/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { appendFileSync } = require('node:fs');
const { logRateLimit, writeCoreRemainingOutput } = require('./rate-limit.cjs');
const { startRestCounter } = require('./rest-counter.cjs');
const { installGhCounter } = require('./gh-counter.cjs');

const reportAtJobEnd = process.env['INPUT_REPORT-AT-JOB-END'] === 'true';

const dir = startRestCounter();
if (
  dir &&
  process.platform === 'linux' &&
  process.env['INPUT_DEFER-GH-COUNTER'] !== 'true' &&
  !installGhCounter(dir, process.env['INPUT_REST-COUNTER'] === 'true')
) {
  console.log(
    '::warning::GitHub CLI request counting unavailable (setup-failed)',
  );
  try {
    appendFileSync(
      process.env.GITHUB_ENV,
      'REST_COUNTER_GH_UNAVAILABLE=true\n',
    );
  } catch {
    // The quota snapshot and Node counter can continue.
  }
}

logRateLimit({ phase: reportAtJobEnd ? 'job-start' : 'snapshot' }).then(
  (resources) => {
    try {
      writeCoreRemainingOutput({ resources });
    } catch (error) {
      console.log(
        `::warning::Unable to write the core-remaining output: ${error.message}`,
      );
    }
  },
);
