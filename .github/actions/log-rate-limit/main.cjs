/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { logRateLimit, writeCoreRemainingOutput } = require('./rate-limit.cjs');
const { startRestCounter } = require('./rest-counter.cjs');

const reportAtJobEnd = process.env['INPUT_REPORT-AT-JOB-END'] === 'true';

startRestCounter();

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
