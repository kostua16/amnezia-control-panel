# Workflow Scripts

Helper scripts consumed by GitHub Actions workflows.

## Test Convention

Tests for `.github/workflows/scripts/*.cjs` live in `src/lib/__tests__/upsert-planning-pr.test.ts` (and similar files).

Each test file uses `createRequire(import.meta.url)` to load CJS modules from the workflow scripts directory:

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  myFunction,
} = require('../../../.github/workflows/scripts/my-script.cjs');
```

### Adding Tests for a New Script

1. Create `src/lib/__tests__/my-script.test.ts`
2. Import functions via `createRequire` as shown above
3. Add new test functions — do not modify existing test files unless the change is cross-cutting
4. Run `npm test` to verify

### Constraints

- Tests run under `node --test` (Node.js built-in test runner)
- CJS scripts must export their functions via `module.exports`
- Scripts under `.github/workflows/scripts/` are loaded by GitHub Actions; keep them self-contained with no local imports beyond `node:` stdlib
