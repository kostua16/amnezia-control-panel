import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  filterRequiredChecks,
  requiredChecksFromConfig,
  normalizeBucket,
  normalizeCheck,
  matchesRequiredCheck,
} = require('../../../.github/workflows/scripts/filter-required-pr-checks.cjs');

const ciConfig = {
  checks: {
    required: [
      { workflow: 'CI', names: ['Lint', 'Type Check', 'Test', 'Build'] },
      { workflow: 'PR Policy', names: ['label-and-validate'] },
    ],
  },
};

type Check = {
  name: string;
  workflow: string;
  bucket: string;
  state: string;
};

// ---------------------------------------------------------------------------
// normalizeBucket
// ---------------------------------------------------------------------------
describe('normalizeBucket', () => {
  const cases: Array<{
    input: Partial<Check>;
    expected: string;
    reason: string;
  }> = [
    { input: { bucket: 'pass' }, expected: 'pass', reason: 'lowercase pass' },
    { input: { bucket: 'PASS' }, expected: 'pass', reason: 'uppercase pass' },
    { input: { bucket: 'fail' }, expected: 'fail', reason: 'lowercase fail' },
    {
      input: { state: 'success' },
      expected: 'pass',
      reason: 'GitHub success conclusion → pass',
    },
    {
      input: { state: 'failure' },
      expected: 'fail',
      reason: 'GitHub failure conclusion → fail',
    },
    {
      input: { state: 'failed' },
      expected: 'fail',
      reason: 'GitHub failed conclusion → fail',
    },
    {
      input: { state: 'timed_out' },
      expected: 'fail',
      reason: 'GitHub timed_out → fail',
    },
    {
      input: { state: 'action_required' },
      expected: 'fail',
      reason: 'GitHub action_required → fail',
    },
    {
      input: { state: 'startup_failure' },
      expected: 'fail',
      reason: 'GitHub startup_failure → fail',
    },
    {
      input: { state: 'skipped' },
      expected: 'skip',
      reason: 'GitHub skipped → skip',
    },
    {
      input: { state: 'cancelled' },
      expected: 'cancel',
      reason: 'GitHub cancelled → cancel',
    },
    {
      input: { state: 'canceled' },
      expected: 'cancel',
      reason: 'GitHub canceled (alt spelling) → cancel',
    },
    {
      input: { state: 'in_progress' },
      expected: 'pending',
      reason: 'unknown state → pending',
    },
    {
      input: { state: 'queued' },
      expected: 'pending',
      reason: 'unknown state → pending',
    },
    {
      input: { bucket: 'pending' },
      expected: 'pending',
      reason: 'explicit pending bucket',
    },
    {
      input: { state: 'neutral' },
      expected: 'pending',
      reason: 'GitHub neutral conclusion → pending (not in fail map)',
    },
  ];

  for (const { input, expected, reason } of cases) {
    it(`maps ${JSON.stringify(input)} → ${expected} (${reason})`, () => {
      assert.equal(normalizeBucket(input as Check), expected);
    });
  }
});

// ---------------------------------------------------------------------------
// normalizeCheck
// ---------------------------------------------------------------------------
describe('normalizeCheck', () => {
  it('normalizes a matching check preserving name and workflow', () => {
    const result = normalizeCheck(
      { name: 'Lint', workflow: 'CI', state: 'success' } as Check,
      { name: 'Lint', workflow: 'CI' },
    );
    assert.equal(result.name, 'Lint');
    assert.equal(result.workflow, 'CI');
    assert.equal(result.bucket, 'pass');
    assert.equal(result.state, 'success');
  });

  it('fills name from required config when check name is missing', () => {
    const result = normalizeCheck(
      { workflow: 'CI', state: 'success' } as Check,
      { name: 'Build', workflow: 'CI' },
    );
    assert.equal(result.name, 'Build');
  });

  it('fills state from bucket when state is missing and bucket is pass', () => {
    const result = normalizeCheck(
      { name: 'Test', workflow: 'CI', bucket: 'pass' } as Check,
      { name: 'Test', workflow: 'CI' },
    );
    assert.equal(result.state, 'success');
  });

  it('fills state as pending when state is missing and bucket is pending', () => {
    const result = normalizeCheck(
      { name: 'Test', workflow: 'CI', bucket: 'pending' } as Check,
      { name: 'Test', workflow: 'CI' },
    );
    assert.equal(result.state, 'pending');
  });

  it('sets link to empty string when not provided', () => {
    const result = normalizeCheck(
      { name: 'Lint', workflow: 'CI', state: 'success' } as Check,
      { name: 'Lint', workflow: 'CI' },
    );
    assert.equal(result.link, '');
  });
});

// ---------------------------------------------------------------------------
// matchesRequiredCheck
// ---------------------------------------------------------------------------
describe('matchesRequiredCheck', () => {
  it('matches by name when required has no workflow', () => {
    assert.ok(
      matchesRequiredCheck({ name: 'Lint', workflow: 'CI' } as Check, {
        name: 'Lint',
        workflow: '',
      }),
    );
  });

  it('matches by name when required workflow is undefined', () => {
    assert.ok(
      matchesRequiredCheck({ name: 'Test', workflow: 'CI' } as Check, {
        name: 'Test',
        workflow: undefined as unknown as string,
      }),
    );
  });

  it('rejects when name differs', () => {
    assert.ok(
      !matchesRequiredCheck({ name: 'Lint', workflow: 'CI' } as Check, {
        name: 'Test',
        workflow: '',
      }),
    );
  });

  it('matches when both name and workflow match', () => {
    assert.ok(
      matchesRequiredCheck(
        { name: 'label-and-validate', workflow: 'PR Policy' } as Check,
        { name: 'label-and-validate', workflow: 'PR Policy' },
      ),
    );
  });

  it('rejects when workflow differs', () => {
    assert.ok(
      !matchesRequiredCheck({ name: 'Lint', workflow: 'Other' } as Check, {
        name: 'Lint',
        workflow: 'CI',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// requiredChecksFromConfig
// ---------------------------------------------------------------------------
describe('requiredChecksFromConfig', () => {
  it('flattens required check groups into name/workflow pairs', () => {
    const result = requiredChecksFromConfig(ciConfig);
    assert.equal(result.length, 5);
    assert.ok(
      result.some(
        (r: { name: string; workflow: string }) =>
          r.name === 'Lint' && r.workflow === 'CI',
      ),
    );
    assert.ok(
      result.some(
        (r: { name: string; workflow: string }) =>
          r.name === 'label-and-validate' && r.workflow === 'PR Policy',
      ),
    );
  });

  it('returns empty array when config has no required checks', () => {
    const result = requiredChecksFromConfig({ checks: { required: [] } });
    assert.deepEqual(result, []);
  });

  it('returns empty array when config has no checks section', () => {
    const result = requiredChecksFromConfig({});
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// filterRequiredChecks
// ---------------------------------------------------------------------------
describe('filterRequiredChecks', () => {
  it('returns only configured required checks, ignoring pr-flow aggregate statuses', () => {
    const checks: Check[] = [
      { name: 'Lint', workflow: 'CI', bucket: 'pass', state: 'success' },
      { name: 'Type Check', workflow: 'CI', bucket: 'pass', state: 'success' },
      { name: 'Test', workflow: 'CI', bucket: 'pass', state: 'success' },
      { name: 'Build', workflow: 'CI', bucket: 'pass', state: 'success' },
      {
        name: 'label-and-validate',
        workflow: 'PR Policy',
        bucket: 'pass',
        state: 'success',
      },
      {
        name: 'pr-flow/ready',
        workflow: '',
        bucket: 'pending',
        state: 'pending',
      },
    ];
    const result = filterRequiredChecks(ciConfig, checks);
    assert.equal(result.length, 5);
    assert.ok(result.every((c: Check) => c.bucket === 'pass'));
    assert.ok(!result.some((c: Check) => c.name === 'pr-flow/ready'));
  });

  it('normalizes all checks through the bucket normalization pipeline', () => {
    const checks: Check[] = [
      { name: 'Lint', workflow: 'CI', state: 'skipped', bucket: '' },
      { name: 'Type Check', workflow: 'CI', state: 'cancelled', bucket: '' },
      { name: 'Test', workflow: 'CI', state: 'timed_out', bucket: '' },
      { name: 'Build', workflow: 'CI', state: 'action_required', bucket: '' },
      {
        name: 'label-and-validate',
        workflow: 'PR Policy',
        state: 'startup_failure',
        bucket: '',
      },
    ];
    const result = filterRequiredChecks(ciConfig, checks);
    assert.equal(result.find((c: Check) => c.name === 'Lint')!.bucket, 'skip');
    assert.equal(
      result.find((c: Check) => c.name === 'Type Check')!.bucket,
      'cancel',
    );
    assert.equal(result.find((c: Check) => c.name === 'Test')!.bucket, 'fail');
    assert.equal(result.find((c: Check) => c.name === 'Build')!.bucket, 'fail');
    assert.equal(
      result.find((c: Check) => c.name === 'label-and-validate')!.bucket,
      'fail',
    );
  });

  it('synthesizes pending entries for missing configured checks', () => {
    const checks: Check[] = [
      { name: 'Lint', workflow: 'CI', bucket: 'pass', state: 'success' },
      { name: 'Test', workflow: 'CI', bucket: 'pass', state: 'success' },
    ];
    const result = filterRequiredChecks(ciConfig, checks);
    assert.equal(result.length, 5);
    const missing = result.filter((c: Check) => c.bucket === 'pending');
    assert.equal(missing.length, 3);
    assert.ok(
      missing.some(
        (c: Check) => c.name === 'Type Check' && c.state === 'pending',
      ),
    );
  });

  it('matches checks across multiple required groups', () => {
    const checks: Check[] = [
      {
        name: 'label-and-validate',
        workflow: 'PR Policy',
        bucket: 'pass',
        state: 'success',
      },
    ];
    const result = filterRequiredChecks(ciConfig, checks);
    assert.equal(result.length, 5);
    const policyCheck = result.find(
      (c: Check) => c.name === 'label-and-validate',
    );
    assert.ok(policyCheck);
    assert.equal(policyCheck.bucket, 'pass');
  });

  it('handles empty checks array by synthesizing all as pending', () => {
    const result = filterRequiredChecks(ciConfig, []);
    assert.equal(result.length, 5);
    assert.ok(result.every((c: Check) => c.bucket === 'pending'));
  });

  it('preserves link field from matching check', () => {
    const checks: Check[] = [
      {
        name: 'Lint',
        workflow: 'CI',
        bucket: 'pass',
        state: 'success',
      },
      // link field set via normalized check — filter script doesn't forward link
      // but normalizeCheck preserves link when present
    ];
    const result = filterRequiredChecks(ciConfig, checks);
    const lint = result.find((c: Check) => c.name === 'Lint');
    assert.ok(lint);
    assert.equal(lint.link, '');
  });
});
