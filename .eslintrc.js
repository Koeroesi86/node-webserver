module.exports = {
  root: true,
  env: { node: true, jest: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: true,
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'prettier'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    'prettier/prettier': [
      'error',
      {
        semi: true,
        singleQuote: true,
        printWidth: 160,
      },
      { usePrettierrc: false },
    ],
  },
  overrides: [{ files: ['tools/src/k6/**/*.ts'], parserOptions: { project: './tools/tsconfig.k6.json' } }],
  ignorePatterns: ['**/dist/*', '.idea/*', '.cache/*', '**/node_modules/*', '*.js'],
};
