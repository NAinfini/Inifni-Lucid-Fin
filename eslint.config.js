import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/coverage/**',
  '**/.vite/**',
  '**/.turbo/**',
  '**/*.d.ts',
  '**/*.tsbuildinfo',
  '**/*.generated.ts',
  '**/*.generated.cts',
];

export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ── Phase A: Redline rules ─────────────────────────────────────

  // Redline: renderer must not import from contracts-parse (zod stays out of renderer)
  {
    files: ['apps/desktop-renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@lucid-fin/contracts-parse', '@lucid-fin/contracts-parse/*'],
              message:
                'Renderer must not import from contracts-parse — it pulls zod into the renderer bundle. Import types from @lucid-fin/contracts instead.',
            },
            {
              group: ['@lucid-fin/application/dist/*', '@lucid-fin/application/dist/**'],
              message:
                'Renderer must not deep-import from application/dist/. Use @lucid-fin/shared-utils or @lucid-fin/contracts.',
            },
          ],
        },
      ],
    },
  },

  // Redline: contracts must not import zod (zero-runtime pact)
  {
    files: ['packages/contracts/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['zod', 'zod/*'],
              message:
                'packages/contracts is type-only — zero zod by pact. Runtime schemas go in @lucid-fin/contracts-parse.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.{test,spec}.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
);
