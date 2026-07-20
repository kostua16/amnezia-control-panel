const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureRuntimeEnv, isUnset } = require('../ensure-runtime-env.cjs');

describe('isUnset', () => {
  it('treats undefined, empty, and whitespace as unset', () => {
    assert.equal(isUnset(undefined), true);
    assert.equal(isUnset(''), true);
    assert.equal(isUnset('   '), true);
    assert.equal(isUnset('secret'), false);
  });
});

describe('ensureRuntimeEnv', () => {
  /** @type {string | undefined} */
  let prevJwt;
  /** @type {string | undefined} */
  let prevAdmin;
  /** @type {string | undefined} */
  let tempRoot;

  beforeEach(() => {
    prevJwt = process.env.JWT_SECRET;
    prevAdmin = process.env.ADMIN_PASSWORD;
    delete process.env.JWT_SECRET;
    delete process.env.ADMIN_PASSWORD;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-env-'));
  });

  afterEach(() => {
    if (prevJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
    if (prevAdmin === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdmin;
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it('generates JWT_SECRET and defaults ADMIN_PASSWORD in development', () => {
    ensureRuntimeEnv({ mode: 'development', root: tempRoot });
    assert.ok(process.env.JWT_SECRET);
    assert.match(process.env.JWT_SECRET, /^[a-f0-9]{64}$/);
    assert.equal(process.env.ADMIN_PASSWORD, 'admin');
  });

  it('generates JWT_SECRET but does not default ADMIN_PASSWORD in production', () => {
    ensureRuntimeEnv({ mode: 'production', root: tempRoot });
    assert.ok(process.env.JWT_SECRET);
    assert.equal(process.env.ADMIN_PASSWORD, undefined);
  });

  it('keeps JWT_SECRET and ADMIN_PASSWORD from .env when present', () => {
    fs.writeFileSync(
      path.join(tempRoot, '.env'),
      'JWT_SECRET=from-dotenv-file-value-32chars-min\nADMIN_PASSWORD=from-env\n',
      'utf8',
    );
    ensureRuntimeEnv({ mode: 'development', root: tempRoot });
    assert.equal(process.env.JWT_SECRET, 'from-dotenv-file-value-32chars-min');
    assert.equal(process.env.ADMIN_PASSWORD, 'from-env');
  });

  it('does not override already-set process env', () => {
    process.env.JWT_SECRET = 'already-set-secret';
    process.env.ADMIN_PASSWORD = 'already-set-admin';
    ensureRuntimeEnv({ mode: 'development', root: tempRoot });
    assert.equal(process.env.JWT_SECRET, 'already-set-secret');
    assert.equal(process.env.ADMIN_PASSWORD, 'already-set-admin');
  });
});
