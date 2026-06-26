import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Never lint build output or dependencies.
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },

  // Base JS + TypeScript recommended rules for every source file.
  {
    files: ['**/*.{js,ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },

  // Backend: Node.js runtime globals.
  {
    files: ['packages/backend/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Frontend: browser globals + React rules.
  {
    files: ['packages/frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Config files run in Node.
  {
    files: ['**/*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
);
