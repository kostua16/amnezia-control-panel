/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { logRateLimit } = require('./rate-limit.cjs');
const { reportRestCounter } = require('./rest-counter.cjs');

if (process.env['INPUT_REPORT-AT-JOB-END'] === 'true') {
  reportRestCounter();
  logRateLimit({ phase: 'job-end' });
}
