const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettierPlugin = require('eslint-plugin-prettier');

// the folders with a barrel: FUNCTION_FOLDERS of tools/src/constants/function-folders.ts (eslint cannot import it) and the other folders that have an index.ts
const BARREL_FOLDERS = [
  ...['utils', 'acme', 'children', 'compression', 'configuration', 'lifecycle', 'observability', 'problems', 'proxy', 'reload', 'request', 'routing', 'tls'],
  ...['hand-off', 'metrics', 'static', 'websocket', 'worker', 'event', 'lambda', 'response'],
  ...['cli', 'service', 'service-files'],
  ...['child', 'errors', 'channel', 'pooling'],
  ...['checks', 'compare', 'coverage', 'load-test', 'report', 'versions'],
  ...['middlewares', 'classes', 'server'],
];

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
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // a folder is imported through its index.ts, so that a file can be renamed or moved inside it without touching the ones outside; the files of a folder import each other directly (`./name`)
            { group: [...BARREL_FOLDERS.map((folder) => `**/${folder}/*`), '!**/*.test-helper'], message: 'Import the folder (its index.ts), not a file in it.' },
            // the package entry is what its exports map says: the root, and the pool of node-worker
            { group: ['@koeroesi86/*/*', '!@koeroesi86/node-worker/pool'], message: 'Import the package, not a file in it: only the entries of its exports map are public.' },
          ],
        },
      ],
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
