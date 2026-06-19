import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@/generated/prisma/client';
import { isPrismaUniqueViolation, isPrismaNotFound } from '../prisma-errors';

function makePrismaError(code: string, message = 'db error') {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '7.8.0',
  });
}

describe('isPrismaUniqueViolation', () => {
  it('returns true for P2002', () => {
    assert.strictEqual(isPrismaUniqueViolation(makePrismaError('P2002')), true);
  });

  it('returns false for P2025', () => {
    assert.strictEqual(
      isPrismaUniqueViolation(makePrismaError('P2025')),
      false,
    );
  });

  it('returns false for null', () => {
    assert.strictEqual(isPrismaUniqueViolation(null), false);
  });

  it('returns false for plain Error', () => {
    assert.strictEqual(isPrismaUniqueViolation(new Error('oops')), false);
  });
});

describe('isPrismaNotFound', () => {
  it('returns true for P2025', () => {
    assert.strictEqual(isPrismaNotFound(makePrismaError('P2025')), true);
  });

  it('returns false for P2002', () => {
    assert.strictEqual(isPrismaNotFound(makePrismaError('P2002')), false);
  });

  it('returns false for undefined', () => {
    assert.strictEqual(isPrismaNotFound(undefined), false);
  });
});
