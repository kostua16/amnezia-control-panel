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
    // Claude skills are vendored local tooling; do not lint their sources.
    '.claude/skills/**',
    // Claude script helpers are managed as local agent tooling.
    '.claude/scripts/**',
    // Codex/agent local tooling is managed outside app lint rules.
    '.codex/skills/**',
    '.codex/scripts/**',
    '.agents/skills/**',
    '.agents/scripts/**',
    // Claude skills/agents use CommonJS require():
    '.claude/**',
    // Parallel .claude/ checkout created at runtime by claude-driven workflows
    // (run-zai/claude-code-action) so the agent runs with PR-scoped config.
    // Untracked, never committed; ignored so eslint . / next build never trip
    // on its vendored .cjs tooling. See docs/adr/0002-pre-push-gate-for-claude-driven-workflows.md
    '.claude-pr/**',
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
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  eslintConfigPrettier,
]);

export default eslintConfig;
