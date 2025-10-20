// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'node_modules',
      '.output',
      'dist',
      'coverage',
      'playwright-report',
      'test-results',
      '.wxt',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
    ]
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  // Test files: relax some rules for pragmatic test code
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',  // Tests can use any for chrome.storage mocking
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],  // Allow _ prefix for unused args
    }
  }
);