import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import sifer from './tools/eslint-plugin-sifer/index.mjs';

const socketIoMessage =
  'socket.io-client is imported only inside packages/realtime. Use @sifer/realtime.';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/target/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/gen/**',
    '**/generated/**',
    'tools/eslint-plugin-sifer/test/fixtures/**',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { sifer },
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'sifer/no-contract-shadow': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'socket.io-client', message: socketIoMessage }],
          patterns: [{ group: ['socket.io-client/*'], message: socketIoMessage }],
        },
      ],
    },
  },
  {
    files: ['apps/motion/src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['packages/realtime/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
]);
