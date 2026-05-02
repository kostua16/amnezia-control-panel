/**
 * Preload script: redirects prisma and tailscale imports to mock modules.
 *
 * This prevents:
 *   - transport-resolver.ts -> prisma.ts -> @/generated/prisma/client
 *   - transport-resolver.ts -> tailscale.ts -> child_process (CLI calls in tests)
 *
 * Usage: node --import tsx --require ./src/lib/__tests__/_setup-transport-mock.cjs src/lib/__tests__/transport-resolver.test.ts
 */

const Module = require('module');
const path = require('path');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, parent, ...args) {
  if (!parent || typeof request !== 'string') {
    return originalResolveFilename.call(this, request, parent, ...args);
  }

  const parentFile = parent.filename || '';

  // Match tailscale relative imports from transport-resolver or its test
  if (
    (request === '../tailscale' ||
      request === './tailscale' ||
      request.endsWith('/tailscale') ||
      request.endsWith('/tailscale.ts')) &&
    (parentFile.includes('transport-resolver') ||
      parentFile.includes('transport-resolver.test'))
  ) {
    const mockPath = path.resolve(__dirname, '_tailscale-mock.cjs');
    return originalResolveFilename.call(this, mockPath, parent, ...args);
  }

  // Match prisma relative imports from transport-resolver or its test
  if (
    (request === '../prisma' ||
      request === './prisma' ||
      request.endsWith('/prisma') ||
      request.endsWith('/prisma.ts')) &&
    (parentFile.includes('transport-resolver') ||
      parentFile.includes('transport-resolver.test'))
  ) {
    const mockPath = path.resolve(__dirname, '_prisma-mock.cjs');
    return originalResolveFilename.call(this, mockPath, parent, ...args);
  }

  return originalResolveFilename.call(this, request, parent, ...args);
};
