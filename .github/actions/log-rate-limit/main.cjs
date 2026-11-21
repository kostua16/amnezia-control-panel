/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { logRateLimit } = require('./rate-limit.cjs');

const reportAtJobEnd = process.env['INPUT_REPORT-AT-JOB-END'] === 'true';

logRateLimit({ phase: reportAtJobEnd ? 'job-start' : 'snapshot' });
