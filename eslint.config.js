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
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      'max-depth': ['error', 1],
      'no-restricted-syntax': ['error', { selector: "Literal[raw='null']:not(BinaryExpression > Literal)", message: 'Use undefined instead of null.' }],
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
    files: ['**/*.test.ts', '**/*.test-helper.ts', '**/test-helpers/**/*.ts', '**/__mocks__/**/*.ts'],
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
