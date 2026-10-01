module.exports = {
  root: true,
  env: { node: true, jest: true },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'commonjs',
  },
  plugins: ['prettier'],
  rules: {
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
  ignorePatterns: ['.idea/*', '.cache/*', '**/node_modules/*', 'packages/*/examples/static/*'],
};
