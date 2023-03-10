const typescript = require('@rollup/plugin-typescript');

/** @type {import('rollup').RollupOptions} */
module.exports = {
  input: ['./src/index.ts', './src/Worker.ts'],
  output: {
    dir: './dist',
    format: 'cjs',
    sourcemap: true,
  },
  external: ['child_process'],
  plugins: [typescript({ module: 'esnext' })],
};
