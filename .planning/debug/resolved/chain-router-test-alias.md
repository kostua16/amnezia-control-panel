---
status: resolved
trigger: "chain-router.test.ts fails with Cannot find package '@/lib/prisma' imported from geo-routing.ts"
created: 2026-05-02T00:00:00Z
updated: 2026-05-02T00:01:00Z
goal: find_root_cause_only
---

## Current Focus
hypothesis: "The reported error occurs when running tests WITHOUT tsx (e.g., plain node --test or a hypothetical vitest setup). tsx handles tsconfig paths automatically, but other runners do not. The test currently passes with tsx --test but is fragile because geo-routing.ts has a runtime value import of @/lib/prisma that any non-tsx runner cannot resolve."
test: Verified by running tests with multiple invocations
expecting: Tests pass with tsx, fail without tsx or with vitest
next_action: Deliver diagnosis

## Symptoms
expected: chain-router.test.ts runs successfully like other test files
actual: Cannot find package '@/lib/prisma' imported from geo-routing.ts
errors: "Cannot find package '@/lib/prisma'"
reproduction: Run chain-router.test.ts (5 tests fail to load)
started: N/A (pre-existing issue)

## Eliminated
- hypothesis: "vitest is the test runner and lacks path alias config"
  evidence: "No vitest dependency exists in package.json. Tests use node:test API and tsx as the TypeScript runtime. All tests pass with tsx --test."
  timestamp: 2026-05-02T00:00:30Z

- hypothesis: "config-applier and panel-sync-client tests pass because they avoid @/ imports entirely"
  evidence: "Both passing tests DO import from @/types/* (type-only imports). They also import source files that use @/ imports. The difference is that config-applier.ts and panel-sync-client.ts only use @/ for type-only imports, while geo-routing.ts uses @/ for VALUE imports (import { prisma } from '@/lib/prisma')."
  timestamp: 2026-05-02T00:00:45Z

- hypothesis: "The error currently manifests when running tests with the project's standard tooling"
  evidence: "Running 'tsx --test src/lib/__tests__/*.test.ts' passes all 28 tests including all 5 chain-router tests. Running 'node --import tsx src/lib/__tests__/chain-router.test.ts' also passes all 5 tests."
  timestamp: 2026-05-02T00:01:00Z

## Evidence
- timestamp: 2026-05-02T00:00:10Z
  checked: tsconfig.json paths configuration
  found: "@/*" maps to "./src/*" in tsconfig.json compilerOptions.paths
  implication: TypeScript compiler knows the alias, but runtime module resolution depends on the test runner

- timestamp: 2026-05-02T00:00:15Z
  checked: vitest configuration
  found: No vitest.config.ts exists. No vitest dependency in package.json.
  implication: vitest is NOT the test runner. Tests use node:test API with tsx.

- timestamp: 2026-05-02T00:00:20Z
  checked: Import chain chain-router.test.ts -> chain-router.ts -> geo-routing.ts
  found: chain-router.ts imports { resolveGeoRoute } from './geo-routing' (value import). geo-routing.ts imports { prisma } from '@/lib/prisma' (value import). Test 5 passes sourceIp which triggers resolveGeoRoute at runtime.
  implication: The @/lib/prisma import IS executed at test runtime when sourceIp is provided.

- timestamp: 2026-05-02T00:00:25Z
  checked: What config-applier.ts and panel-sync-client.ts import from @/
  found: config-applier.ts: only type imports from @/types/*. panel-sync-client.ts: only type imports from @/types/*. geo-routing.ts: VALUE import { prisma } from '@/lib/prisma', VALUE import { lookupGeoIP } from '@/lib/geoip-manager', plus type imports.
  implication: Type-only imports are erased at compile time and never resolved at runtime. Value imports MUST be resolved. This is why other tests pass even if @/ resolution is broken.

- timestamp: 2026-05-02T00:00:30Z
  checked: Running all tests with tsx --test
  found: All 28 tests pass (5 chain-router + others). tsx automatically reads tsconfig.json and resolves path aliases.
  implication: The current tooling (tsx) handles path aliases correctly. The reported error does not manifest with tsx.

- timestamp: 2026-05-02T00:00:40Z
  checked: Running tests without tsx (plain node --test)
  found: "Cannot find module 'D:\...\src\lib\chain-router'" -- fails even earlier because extensionless imports are not resolved.
  implication: Without tsx, ALL tests fail, not just chain-router.

- timestamp: 2026-05-02T00:00:45Z
  checked: geo-routing.ts resolveGeoRoute error handling
  found: resolveGeoRoute wraps the entire body in try/catch, returning { matched: false, action: 'ALLOW' } on any error (fail-open per D-04).
  implication: Even if @/lib/prisma resolution failed at runtime, the test would not fail because the error is caught. The test only asserts result.appliedTo !== undefined.

## Resolution
root_cause: "The reported error would occur if tests are run with a runner that does not resolve TypeScript path aliases (e.g., vitest without config, or plain node --test). Currently, tests use tsx which handles this automatically. The core fragility is that geo-routing.ts has a runtime VALUE import of '@/lib/prisma' (and '@/lib/geoip-manager'), while the other test-exercised source files only have type-only @/ imports that are erased at compile time. The test also passes silently even when resolveGeoRoute fails internally because it uses fail-open error handling."
fix:
verification:
files_changed: []
