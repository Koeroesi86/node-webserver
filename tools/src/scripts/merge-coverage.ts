/**
 * Puts the coverage that jest wrote in every package (`pnpm test:coverage`) into `coverage/coverage-final.json`, which `.fallowrc.jsonc`
 * gives to fallow for the exact CRAP scores.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeCoverage } from '../utils/merge-coverage';

const root = resolve(__dirname, '../../..');
const coverage = mergeCoverage(root);

if (Object.keys(coverage).length === 0) {
  throw new Error('No coverage found, run pnpm test:coverage first.');
}

mkdirSync(resolve(root, 'coverage'), { recursive: true });
writeFileSync(resolve(root, 'coverage', 'coverage-final.json'), JSON.stringify(coverage));
console.log(`Coverage of ${Object.keys(coverage).length} files written to coverage/coverage-final.json`);
