/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('js-yaml');

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
  assert.equal(new Set(logins).size, logins.length);
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

const OVERRIDES = new Map([
  ['workflows/triage.yml', 'github-actions[bot],kilo-code-bot'],
  ['workflows/issue-catch-up.yml', 'github-actions[bot]'],
]);

test('workflow and action callers use profiles instead of hardcoded bot lists', () => {
  const repoGithub = path.join(__dirname, '..', '..', '..');
  const offenders = [];
  const exceptions = new Map(OVERRIDES);

  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.ya?ml$/.test(ent.name)) continue;
      const rel = path.relative(repoGithub, full).split(path.sep).join('/');
      const doc = load(fs.readFileSync(full, 'utf8'));
      const jobs = doc.runs ? [doc.runs] : Object.values(doc.jobs ?? {});
      for (const job of jobs) {
        if (
          job.with?.['allowed-bots'] !== undefined ||
          job.with?.allowed_bots !== undefined
        ) {
          offenders.push(rel);
        }
        const steps = job.steps ?? [];
        const envBlocks = [doc.env, job.env, ...steps.map((step) => step.env)];
        const hardcodedEnv = envBlocks.some((env) =>
          Object.entries(env ?? {}).some(
            ([key, value]) =>
              /^allowed[-_]?bots$/i.test(key) &&
              typeof value === 'string' &&
              /(?:\[bot\]|github-actions\s*,)/.test(value),
          ),
        );
        const embedded = [
          ...envBlocks.flatMap((env) => Object.values(env ?? {})),
          ...steps.map((step) => step.run),
        ];
        if (
          hardcodedEnv ||
          embedded.some(
            (value) =>
              typeof value === 'string' &&
              /allowed[-_]bots:\s*['"][^'"]*(?:\[bot\]|github-actions,)[^'"]*['"]/.test(
                value,
              ),
          )
        ) {
          offenders.push(rel);
        }
        for (const [index, step] of steps.entries()) {
          const nativeValue = step.with?.allowed_bots;
          if (
            nativeValue !== undefined &&
            !(
              rel === 'actions/run-claude-params/action.yml' &&
              nativeValue ===
                '${{ steps.resolve-allowed-bots.outputs.allowed_bots }}'
            )
          ) {
            offenders.push(rel);
          }
          const value = step.with?.['allowed-bots'];
          if (value === undefined || value === '${{ inputs.allowed-bots }}')
            continue;
          if (
            value === '${{ steps.workflow-bot-policy.outputs.allowed_bots }}'
          ) {
            const prior = steps.slice(0, index);
            const checkout = prior.find(
              (candidate) =>
                candidate.with?.path === '.git/workflow-bot-policy',
            );
            const resolver = prior.find(
              (candidate) => candidate.id === 'workflow-bot-policy',
            );
            assert.equal(checkout?.with.ref, '${{ github.workflow_sha }}', rel);
            assert.match(resolver?.run ?? '', /resolve-allowed-bots\.cjs/, rel);
            assert.equal(step.with['allowed-bots-profile'], undefined, rel);
            continue;
          }
          if (exceptions.has(rel) && value === exceptions.get(rel)) {
            exceptions.delete(rel);
            continue;
          }
          offenders.push(rel);
        }
      }
    }
  }

  walk(path.join(repoGithub, 'workflows'));
  walk(path.join(repoGithub, 'actions'));
  assert.deepEqual(offenders, []);
  assert.deepEqual([...exceptions], []);
});

test('each policy list entry must contain exactly one login', () => {
  for (const login of [
    'github-actions,claude[bot]',
    'first\nsecond',
    'first second',
  ]) {
    assert.throws(
      () =>
        resolveAllowedBots(
          { allowedBots: { profiles: { invalid: [login] } } },
          { profile: 'invalid' },
        ),
      /invalid login/,
    );
  }
  assert.throws(
    () => resolveAllowedBots(policy, { override: 'first,,second' }),
    /empty login/,
  );
});
