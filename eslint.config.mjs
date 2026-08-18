// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

/**
 * Single ESLint run for the whole monorepo. `pnpm lint` passes
 * `--max-warnings 0`, so the zero-warning policy (CLAUDE.md) is enforced
 * regardless of whether a rule is set to warn or error.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/db/drizzle/**',
      'infra/cdk.out/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Spec section 13 definition of done: zero `any` in packages/schemas and
      // packages/compositions. Enforced repo-wide — nothing here needs `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // Scripts run from the CLI (migrate, seed) and from the deploy pipeline
  // legitimately report to stdout, and run in Node rather than the browser.
  // The infra Lambdas log structured JSON to CloudWatch — console IS the
  // log sink there (spec section 12) — and the deploy scripts print steps.
  {
    files: [
      'packages/db/src/scripts/**/*.ts',
      'scripts/**/*.mjs',
      '**/*.config.{ts,mts,mjs,js}',
      'infra/lambdas/**/*.ts',
      'infra/scripts/**/*.ts',
    ],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },

  prettier,
)
