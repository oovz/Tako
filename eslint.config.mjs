// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url));
const typeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: [
    'src/**/*.{ts,tsx}',
    'entrypoints/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
  ],
}));

export default defineConfig(
  {
    ignores: [
      'node_modules',
      '.output',
      'build',
      'dist',
      'coverage',
      'playwright-report',
      'test-results',
      '.wxt',
      '.env*',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
    ]
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir,
      },
    },
  },
  {
    files: [
      'src/**/*.{ts,tsx}',
      'entrypoints/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          ignoreVoid: true,
        },
      ],
    },
  },
  {
    files: [
      'entrypoints/background/**/*.{ts,tsx}',
      'src/runtime/background-*.{ts,tsx}',
      'src/runtime/site-integration-background-*.{ts,tsx}',
      'src/runtime/generated/site-integration-background-registry.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              '@/src/runtime/site-integration-content-*',
              '@/src/runtime/site-integration-offscreen-*',
              '@/src/runtime/generated/site-integration-content-registry',
              '@/src/runtime/generated/site-integration-offscreen-registry',
              '@/src/site-integrations/*/content-runtime',
              '@/src/site-integrations/*/offscreen-runtime',
            ],
            message: 'Background code must only import metadata and background site-integration runtimes.',
          },
        ],
      }],
    },
  },
  {
    files: [
      'entrypoints/content/**/*.{ts,tsx}',
      'src/runtime/site-integration-content-*.{ts,tsx}',
      'src/runtime/generated/site-integration-content-registry.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              '@/src/runtime/background-site-integration-initialization',
              '@/src/runtime/site-integration-background-*',
              '@/src/runtime/site-integration-offscreen-*',
              '@/src/runtime/generated/site-integration-background-registry',
              '@/src/runtime/generated/site-integration-offscreen-registry',
              '@/src/site-integrations/*/background-runtime',
              '@/src/site-integrations/*/offscreen-runtime',
            ],
            message: 'Content code must only import content site-integration runtimes.',
          },
        ],
      }],
    },
  },
  {
    files: [
      'entrypoints/offscreen/**/*.{ts,tsx}',
      'src/runtime/site-integration-offscreen-*.{ts,tsx}',
      'src/runtime/generated/site-integration-offscreen-registry.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: [
              '@/src/runtime/background-site-integration-initialization',
              '@/src/runtime/site-integration-background-*',
              '@/src/runtime/site-integration-content-*',
              '@/src/runtime/generated/site-integration-background-registry',
              '@/src/runtime/generated/site-integration-content-registry',
              '@/src/site-integrations/*/background-runtime',
              '@/src/site-integrations/*/content-runtime',
            ],
            message: 'Offscreen code must only import offscreen site-integration runtimes.',
          },
        ],
      }],
    },
  },
  ...typeCheckedConfigs,
  // Scripts: Node.js environment with relaxed rules
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
      sourceType: 'module',
      ecmaVersion: 2022,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    }
  },
  // Test files: relax some rules for pragmatic test code
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',  // Tests can use any for chrome.storage mocking
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],  // Allow _ prefix for unused args
    }
  }
);
