/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { logRateLimit } = require('./rate-limit.cjs');
const { reportRestCounter } = require('./rest-counter.cjs');

try {
  reportRestCounter();
} catch {
  console.log('::warning::REST counter post report unavailable');
}
if (process.env['INPUT_REPORT-AT-JOB-END'] === 'true') {
  logRateLimit({ phase: 'job-end' });
}
