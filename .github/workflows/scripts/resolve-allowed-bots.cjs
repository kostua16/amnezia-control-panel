#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * Resolve claude-code-action allowed_bots from policy.json profiles.
 * github-actions and github-actions[bot] stay distinct exact logins.
 */

const fs = require('fs');
const path = require('path');

const KNOWN_PROFILES = ['interactive', 'orchestrated'];

function getArg(name, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? '';
}

function parseCsv(raw) {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function assertExactLogins(logins, source) {
  if (!Array.isArray(logins) || logins.length === 0) {
    throw new Error(`${source} must be a non-empty list of exact bot logins`);
  }
  for (const login of logins) {
    if (typeof login !== 'string' || !login.trim()) {
      throw new Error(`${source} contains an empty login`);
    }
    if (login.includes('*') || login.includes('?')) {
      throw new Error(`${source} rejects wildcard login: ${login}`);
    }
  }
  return logins.map((login) => login.trim());
}

function loadPolicy(policyPath) {
  const raw = fs.readFileSync(policyPath, 'utf8');
  return JSON.parse(raw);
}

function resolveAllowedBots(policy, { profile = '', override = '' } = {}) {
  const trimmedOverride = String(override || '').trim();
  if (trimmedOverride) {
    return assertExactLogins(
      parseCsv(trimmedOverride),
      'allowed-bots override',
    );
  }

  const trimmedProfile = String(profile || '').trim();
  if (!trimmedProfile) return [];

  const profiles = policy && policy.allowedBots && policy.allowedBots.profiles;
  if (!profiles || typeof profiles !== 'object') {
    throw new Error('policy.json is missing allowedBots.profiles');
  }
  if (!Object.prototype.hasOwnProperty.call(profiles, trimmedProfile)) {
    throw new Error(`unknown allowed-bots profile: ${trimmedProfile}`);
  }
  return assertExactLogins(
    profiles[trimmedProfile],
    `allowedBots.profiles.${trimmedProfile}`,
  );
}

function formatAllowedBots(logins) {
  return logins.join(',');
}

function main({ argv = process.argv } = {}) {
  const policyPath =
    getArg('--policy', argv) || path.join(__dirname, '..', 'policy.json');
  const profile = getArg('--profile', argv) || '';
  const override = getArg('--override', argv) || '';
  const outputPath =
    getArg('--github-output', argv) || process.env.GITHUB_OUTPUT;

  const policy = loadPolicy(policyPath);
  const logins = resolveAllowedBots(policy, { profile, override });
  const value = formatAllowedBots(logins);
  if (outputPath) {
    fs.appendFileSync(outputPath, `allowed_bots=${value}\n`);
  } else {
    process.stdout.write(`${value}\n`);
  }
  return { allowed_bots: value, logins };
}

module.exports = {
  KNOWN_PROFILES,
  parseCsv,
  assertExactLogins,
  resolveAllowedBots,
  formatAllowedBots,
  main,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
  }
}
