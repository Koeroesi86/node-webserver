import { resolve } from 'path';

/** folder of the package, both from src/ and dist/ */
export const PACKAGE_ROOT = resolve(__dirname, '../..');

export const DEFAULT_CONFIGURATION_PATH = resolve(PACKAGE_ROOT, 'configuration.example.js');
