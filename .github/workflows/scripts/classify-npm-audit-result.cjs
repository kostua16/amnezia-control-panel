/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');

const RESULTS = Object.freeze({
  CLEAN: 'clean',
  INFRASTRUCTURE: 'infrastructure',
  VULNERABILITIES: 'vulnerabilities',
});

function isAuditReport(report) {
  const vulnerabilities = report?.metadata?.vulnerabilities;
  return (
    vulnerabilities !== null &&
    typeof vulnerabilities === 'object' &&
    Number.isInteger(vulnerabilities.total) &&
    vulnerabilities.total >= 0
  );
}

function classifyNpmAuditResult({ exitCode, report }) {
  if (!isAuditReport(report)) return RESULTS.INFRASTRUCTURE;
  if (exitCode === 0) return RESULTS.CLEAN;
  if (exitCode === 1) return RESULTS.VULNERABILITIES;
  return RESULTS.INFRASTRUCTURE;
}

function readReport(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

if (require.main === module) {
  const [reportPath, rawExitCode] = process.argv.slice(2);
  const exitCode = Number(rawExitCode);
  const result = classifyNpmAuditResult({
    exitCode,
    report: readReport(reportPath),
  });
  process.stdout.write(result);
}

module.exports = {
  RESULTS,
  classifyNpmAuditResult,
  isAuditReport,
  readReport,
};
