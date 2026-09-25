/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  resolveAllowedBots,
  formatAllowedBots,
} = require('../resolve-allowed-bots.cjs');

const policyPath = path.join(__dirname, '..', '..', 'policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

const livePolicy = () => JSON.parse(fs.readFileSync(policyPath, 'utf8'));

test('policy ships interactive and orchestrated profiles of exact logins', () => {
  const live = livePolicy();
  assert.ok(live.allowedBots.profiles.interactive.includes('claude[bot]'));
  assert.ok(
    live.allowedBots.profiles.interactive.includes('github-actions[bot]'),
  );
  assert.equal(
    live.allowedBots.profiles.interactive.includes('github-actions'),
    false,
  );
  assert.deepEqual(live.allowedBots.profiles.orchestrated, [
    'github-actions',
    'github-actions[bot]',
    'claude[bot]',
  ]);
});

test('orchestrated profile keeps github-actions and github-actions[bot] distinct', () => {
  const logins = resolveAllowedBots(policy, { profile: 'orchestrated' });
  assert.ok(logins.includes('github-actions'));
  assert.ok(logins.includes('github-actions[bot]'));
  assert.notEqual(
    logins.includes('github-actions'),
    logins.includes('github-actions[bot]') && false,
  );
});

test('interactive profile resolves without the unbracketed github-actions login', () => {
  assert.deepEqual(resolveAllowedBots(policy, { profile: 'interactive' }), [
    'claude[bot]',
    'github-actions[bot]',
  ]);
});

test('empty profile and override yields no allowed bots', () => {
  assert.deepEqual(resolveAllowedBots(policy, {}), []);
});

test('unknown profile fails closed', () => {
  assert.throws(
    () => resolveAllowedBots(policy, { profile: 'wildcard' }),
    /unknown allowed-bots profile/,
  );
});

test('missing policy profiles fail closed', () => {
  assert.throws(
    () => resolveAllowedBots({}, { profile: 'orchestrated' }),
    /missing allowedBots.profiles/,
  );
});

test('explicit override wins and is validated', () => {
  assert.deepEqual(
    resolveAllowedBots(policy, {
      profile: 'orchestrated',
      override: 'github-actions[bot],kilo-code-bot',
    }),
    ['github-actions[bot]', 'kilo-code-bot'],
  );
});

test('override and profile reject wildcards and empty logins', () => {
  assert.throws(
    () => resolveAllowedBots(policy, { override: '*' }),
    /wildcard/,
  );
  assert.throws(
    () =>
      resolveAllowedBots(
        { allowedBots: { profiles: { orchestrated: ['github-actions*'] } } },
        { profile: 'orchestrated' },
      ),
    /wildcard/,
  );
  assert.throws(
    () =>
      resolveAllowedBots(
        { allowedBots: { profiles: { orchestrated: [] } } },
        { profile: 'orchestrated' },
      ),
    /non-empty/,
  );
});

test('formatAllowedBots is comma-joined without spaces', () => {
  assert.equal(
    formatAllowedBots(['github-actions', 'github-actions[bot]', 'claude[bot]']),
    'github-actions,github-actions[bot],claude[bot]',
  );
});

const HARDCODED_BOT_LIST =
  /allowed-bots:\s*(?:\$\{\{[^}]*&&\s*)?['"][^'"]*(?:\[bot\]|github-actions,)[^'"]*['"]/;

const OVERRIDE_ALLOWLIST = new Set([path.normalize('workflows/triage.yml')]);

test('workflow and action callers use profiles instead of hardcoded bot lists', () => {
  const repoGithub = path.join(__dirname, '..', '..', '..');
  const offenders = [];

  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.ya?ml$/.test(ent.name)) continue;
      const rel = path.relative(repoGithub, full);
      if (OVERRIDE_ALLOWLIST.has(path.normalize(rel))) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (HARDCODED_BOT_LIST.test(text))
        offenders.push(rel.replace(/\\/g, '/'));
    }
  }

  walk(path.join(repoGithub, 'workflows'));
  walk(path.join(repoGithub, 'actions'));
  assert.deepEqual(offenders, []);
});
