import type { CacheControlRule, PrecompressedEncoding, StaticOptions } from '../types';

export interface NormalizedStaticOptions {
  cacheControl: Array<{ folder?: string; extension?: string; value: string }>;
  listDirectories: boolean;
  precompressed: PrecompressedEncoding[];
}

const encodings: readonly string[] = ['br', 'gzip'];

/** `assets`, `/assets` and `/assets/` are the same folder, without a pattern that backtracks on a long run of slashes */
const normalizeFolder = (folder: string) => {
  const segments = folder.split('/').filter(Boolean);

  return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
};

const normalizeRule = (rule: CacheControlRule) => {
  if (!rule.value || (!rule.folder && !rule.extension)) {
    throw new Error('A cache rule needs a value and a folder or an extension.');
  }

  return {
    value: rule.value,
    ...(rule.folder && { folder: normalizeFolder(rule.folder) }),
    ...(rule.extension && { extension: `.${rule.extension.replace(/^\./, '').toLowerCase()}` }),
  };
};

/** The options of the static worker with their defaults. Throws for ones that are not valid, so that a mistake is found when the middleware is created. */
const normalizeStaticOptions = ({ cacheControl = [], listDirectories = false, precompressed = [] }: StaticOptions = {}): NormalizedStaticOptions => {
  const unknown = precompressed.filter((encoding) => !encodings.includes(encoding));

  if (unknown.length > 0) {
    throw new Error(`Unsupported precompressed encoding: ${unknown.join(', ')}. Use br or gzip.`);
  }

  return { cacheControl: cacheControl.map(normalizeRule), listDirectories, precompressed };
};

export default normalizeStaticOptions;
