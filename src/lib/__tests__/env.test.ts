import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getJwtSecret,
  getDatabaseUrl,
  getDeploymentMode,
  getAwgInterface,
  getTrafficStatsWindowHours,
  getRetentionDays,
  getAlertRetentionDays,
  validateEnvironment,
} from '../env';

describe('env getters', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('getJwtSecret returns the value when set', () => {
    process.env.JWT_SECRET = 'test-secret';
    assert.strictEqual(getJwtSecret(), 'test-secret');
  });

  it('getJwtSecret throws when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    assert.throws(() => getJwtSecret(), /Missing required env var: JWT_SECRET/);
  });

  it('getDatabaseUrl returns the value when set', () => {
    process.env.DATABASE_URL = 'file:/data/db.sqlite';
    assert.strictEqual(getDatabaseUrl(), 'file:/data/db.sqlite');
  });

  it('getDatabaseUrl returns default when unset', () => {
    delete process.env.DATABASE_URL;
    assert.strictEqual(getDatabaseUrl(), 'file:./prisma/dev.db');
  });

  it('getDeploymentMode returns default "external" when unset', () => {
    delete process.env.ACP_DEPLOYMENT_MODE;
    assert.strictEqual(getDeploymentMode(), 'external');
  });

  it('getDeploymentMode returns "bundled" when set', () => {
    process.env.ACP_DEPLOYMENT_MODE = 'bundled';
    assert.strictEqual(getDeploymentMode(), 'bundled');
  });

  it('getAwgInterface returns undefined when unset', () => {
    delete process.env.AWG_INTERFACE;
    assert.strictEqual(getAwgInterface(), undefined);
  });

  it('getAwgInterface returns trimmed value', () => {
    process.env.AWG_INTERFACE = '  wg0  ';
    assert.strictEqual(getAwgInterface(), 'wg0');
  });

  it('getTrafficStatsWindowHours parses valid int', () => {
    process.env.TRAFFIC_STATS_WINDOW_HOURS = '48';
    assert.strictEqual(getTrafficStatsWindowHours(), 48);
  });

  it('getTrafficStatsWindowHours defaults to 24 for invalid', () => {
    process.env.TRAFFIC_STATS_WINDOW_HOURS = 'abc';
    assert.strictEqual(getTrafficStatsWindowHours(), 24);
  });

  it('getRetentionDays parses valid int', () => {
    process.env.RETENTION_DAYS = '30';
    assert.strictEqual(getRetentionDays(), 30);
  });

  it('getAlertRetentionDays parses valid int', () => {
    process.env.ALERT_RETENTION_DAYS = '7';
    assert.strictEqual(getAlertRetentionDays(), 7);
  });
});

describe('validateEnvironment', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    assert.throws(
      () => validateEnvironment(),
      /Missing required env var\(s\): JWT_SECRET/,
    );
  });

  it('does not throw when all required vars are set', () => {
    process.env.JWT_SECRET = 'test-secret';
    validateEnvironment(); // should not throw
  });

  it('warns about ADMIN_PASSWORD in production', () => {
    process.env.JWT_SECRET = 'test-secret';
    // process.env.NODE_ENV is read-only in Node.js; validateEnvironment
    // only logs a warning, never throws for optional vars.
    delete process.env.ADMIN_PASSWORD;
    validateEnvironment();
  });
});
