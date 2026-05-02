/**
 * Mock module for prisma.ts -- used by _setup-transport-mock.cjs
 * to prevent @/generated/prisma/client import during transport-resolver tests.
 */
const createMockMethod = () => {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return {};
  };
  fn.mock = { calls, restore: () => {} };
  fn.mock.reset = () => { calls.length = 0; };
  return fn;
};

module.exports = {
  prisma: {
    server: {
      update: createMockMethod(),
    },
    remotePanel: {
      findMany: createMockMethod(),
    },
    $queryRaw: createMockMethod(),
  },
};
