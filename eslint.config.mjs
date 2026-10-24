import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/out/**',
    '**/dist/**',
    '**/coverage/**',
    '**/next-env.d.ts',
    '.worktrees/**',
    '**/*.cjs',
    '**/*.config.js'
  ]),
  ...nextVitals,
  ...nextTs,
  reactYouMightNotNeedAnEffect.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mjs', 'packages/*/vitest.config.ts']
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      'better-tailwindcss': betterTailwindcss
    },
    settings: {
      next: { rootDir: 'apps/console/' },
      'better-tailwindcss': {
        entryPoint: `${import.meta.dirname}/apps/console/app/globals.css`,
        rootFontSize: 16
      }
    },
    rules: {
      'no-undef': 'error',
      'no-console': 'warn',
      'react/react-in-jsx-scope': 'off',
      'better-tailwindcss/enforce-canonical-classes': 'warn',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-deprecated-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-unknown-classes': 'off',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^react', '^\\w', '^@?', '^@frw?\\w'],
            ['^src(/.*|$)'],
            ['^\\u0000'],
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
            ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
            ['^.+\\.(json|png|jpg|jpeg|txt)$'],
            ['^.+\\.(css|scss)$']
          ]
        }
      ],
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-floating-promises': 'warn'
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off'
    }
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/test-utils/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.vitest }
    },
    rules: {
      'no-console': 'off',
      'react/display-name': 'off',
      '@typescript-eslint/no-floating-promises': 'off'
    }
  },
  {
    files: ['**/scripts/**', '**/cli/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-floating-promises': 'off'
    }
  }
]);
