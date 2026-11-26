/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { logRateLimit, writeCoreRemainingOutput } = require('./rate-limit.cjs');
const {
  reportGhInstallFailure,
  startRestCounter,
} = require('./rest-counter.cjs');
const { installGhCounter } = require('./gh-counter.cjs');

const reportAtJobEnd = process.env['INPUT_REPORT-AT-JOB-END'] === 'true';

const dir = startRestCounter();
if (
  dir &&
  process.platform === 'linux' &&
  process.env['INPUT_DEFER-GH-COUNTER'] !== 'true'
) {
  const outcome = installGhCounter(dir, true);
  if (outcome.startsWith('failed:'))
    reportGhInstallFailure(dir, outcome.slice('failed:'.length));
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
