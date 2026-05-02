/**
 * Mock module for tailscale.ts -- used by _setup-transport-mock.cjs
 * to prevent Tailscale CLI calls during transport-resolver tests.
 */
const createMockFn = (defaultValue) => {
  const calls = [];
  let implementation = typeof defaultValue === 'function' ? defaultValue : () => defaultValue;
  const fn = (...args) => {
    calls.push(args);
    return implementation(...args);
  };
  fn.__mockMeta = {
    calls,
    mockImplementation: (impl) => { implementation = impl; },
    reset: () => { calls.length = 0; },
  };
  return fn;
};

module.exports = {
  getNodeIP: createMockFn(null),
  isReachable: createMockFn(true),
  getStatus: createMockFn(null),
  getNodes: createMockFn([]),
  resolveTransportAddress: createMockFn(null),
  verifyInstalled: createMockFn({ installed: true, version: '1.0.0' }),
  getBackendState: createMockFn('Running'),
  advertiseRoutes: createMockFn({ success: true, message: 'OK' }),
};
