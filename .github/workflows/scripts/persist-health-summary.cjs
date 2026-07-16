#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Persists per-run health summaries as JSONL for trend analysis.
 * Each summary becomes one JSON line — append-friendly, easy to
 * aggregate across runs ("CI 20% slower this week").
 *
 * @param {Array<Object>} runSummaries - Array of run summary objects from collect-runs
 * @param {object} opts
 * @param {string} [opts.outputDir='.'] - Directory to write the JSONL file
 * @param {string} [opts.prefix='health-summary'] - Filename prefix
 * @returns {string|null} Path to the written file, or null if nothing to persist
 */
function persistHealthSummary(runSummaries, opts = {}) {
  const outputDir = opts.outputDir || '.';
  const prefix = opts.prefix || 'health-summary';

  if (!runSummaries || runSummaries.length === 0) return null;

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${prefix}-${ts}.jsonl`;
  const filePath = path.join(outputDir, filename);

  const lines = runSummaries.map(s => JSON.stringify(s)).join('\n');
  fs.writeFileSync(filePath, lines + '\n', 'utf-8');

  return filePath;
}

module.exports = { persistHealthSummary };
