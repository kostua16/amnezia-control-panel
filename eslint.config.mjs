import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Claude skills/agents use CommonJS require():
    '.claude/**',
    // CommonJS launch scripts use require() by design:
    'scripts/dev.cjs',
    'scripts/start.cjs',
  ]),
  // Downgrade React 19 strict rules to warnings for data-fetching patterns.
  // These fire on common useEffect + setState patterns used for API fetching,
  // which have no built-in React alternative yet (React 19 recommendation
  // is useSyncExternalStore, but that doesn't apply to one-shot fetches).
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  eslintConfigPrettier,
]);

export default eslintConfig;
