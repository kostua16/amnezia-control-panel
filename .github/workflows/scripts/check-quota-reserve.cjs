/* eslint-disable @typescript-eslint/no-require-imports */
// Keeps deferrable automation (Auto Cover repairs) from spending the last part
// of the shared REST quota. Reads the core quota that setup-environment already
// logged at job start (no extra API call) and the reserve from QUOTA_RESERVE.
//
// Output (stdout, GITHUB_OUTPUT format): proceed=true|false
// proceed=false only when a valid reading is below a positive reserve; an
// unknown reading or a disabled reserve (0, empty, invalid) proceeds, so a
// missing reading never blocks work.
const fs = require('node:fs');

const DEFAULT_RESERVE = 600;

function parseCount(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

function evaluateQuotaReserve({ remaining, reserve = DEFAULT_RESERVE } = {}) {
  const limit = parseCount(reserve);
  if (!limit) {
    return { proceed: true, reason: 'Quota reserve disabled.' };
  }
  const left = parseCount(remaining);
  if (left === null) {
    return {
      proceed: true,
      reason: 'Core quota reading unavailable; proceeding.',
    };
  }
  if (left < limit) {
    return {
      proceed: false,
      reason: `Core REST quota ${left} is below the reserve of ${limit}; deferring. The next trigger or the 3-hourly scan retries.`,
    };
  }
  return {
    proceed: true,
    reason: `Core REST quota ${left} is at or above the reserve of ${limit}.`,
  };
}

// Writes `proceed=` to GITHUB_OUTPUT (stdout when unset) and the reason to
// the log; a deferral is also a notice annotation and a step-summary line.
function run(env = process.env, log = console.log) {
  const result = evaluateQuotaReserve({
    remaining: env.CORE_REMAINING,
    reserve: env.QUOTA_RESERVE ?? DEFAULT_RESERVE,
  });
  const output = `proceed=${result.proceed}\n`;
  if (result.proceed) {
    log(result.reason);
  } else {
    log(`::notice title=Quota reserve::${result.reason}`);
    if (env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${result.reason}\n`);
    }
  }
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, output);
  } else {
    log(output.trim());
  }
  return result;
}

if (require.main === module) {
  run();
}

module.exports = { DEFAULT_RESERVE, evaluateQuotaReserve, run };
