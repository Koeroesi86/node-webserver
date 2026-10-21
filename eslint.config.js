const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettierPlugin = require('eslint-plugin-prettier');

module.exports = [
  {
    ignores: ['**/dist/**', '.idea/**', '.cache/**', '**/node_modules/**', '**/*.js'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { project: true },
    },
    plugins: { '@typescript-eslint': tsPlugin, prettier: prettierPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-else-return': 'error',
      // the existing violations are warnings that `pnpm lint` caps (`--max-warnings`), so a new one fails and a fix lowers the cap
      '@typescript-eslint/consistent-type-assertions': ['warn', { assertionStyle: 'never' }],
      'max-depth': ['warn', 1],
      'no-restricted-syntax': ['warn', { selector: "Literal[raw='null']", message: 'Use undefined instead of null.' }],
      'prettier/prettier': [
        'error',
        {
          semi: true,
          singleQuote: true,
          printWidth: 160,
          trailingComma: 'es5',
        },
        { usePrettierrc: false },
      ],
    },
  },
  {
    // mocks and fixtures need casts, and the null of a mocked node api
    files: ['**/*.test.ts', '**/*.test-helper.ts', '**/test-helpers/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['tools/src/k6/**/*.ts'],
    languageOptions: { parserOptions: { project: './tools/tsconfig.k6.json' } },
  },
];
