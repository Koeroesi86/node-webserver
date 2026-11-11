import fs from 'fs/promises';
import type { Stats } from 'fs';
import type { PrecompressedEncoding } from '../types';

export interface Precompressed {
  /** a variant exists, so the answer depends on what the client accepts whichever is sent */
  varies: boolean;
  chosen?: { encoding: PrecompressedEncoding; fileName: string; stats: Stats };
}

const extensions: Record<PrecompressedEncoding, string> = { br: '.br', gzip: '.gz' };

const weightOf = (acceptEncoding: string, encoding: string) => {
  const weights = new Map(
    acceptEncoding
      .split(',')
      .map((part) => part.trim().split(/\s*;\s*q=/i))
      .map(([name, weight]) => [name.toLowerCase(), weight === undefined ? 1 : Number(weight)] as const)
  );

  return weights.get(encoding) ?? weights.get('*') ?? 0;
};

/**
 * Looks for `file.js.br` or `file.js.gz` next to the file. The first of `encodings` that exists and that the client accepts is chosen,
 * a client that refuses an encoding (`q=0`) or does not mention it gets the file as it is.
 */
const findPrecompressed = async (fileName: string, acceptEncoding: string | undefined, encodings: PrecompressedEncoding[]): Promise<Precompressed> => {
  const variants = (
    await Promise.all(
      encodings.map(async (encoding) => {
        const variantName = `${fileName}${extensions[encoding]}`;
        const stats = await fs.stat(variantName).catch(() => undefined);

        return stats?.isFile() ? { encoding, fileName: variantName, stats } : undefined;
      })
    )
  ).filter((variant) => variant !== undefined);

  return { varies: variants.length > 0, chosen: variants.find(({ encoding }) => weightOf(acceptEncoding ?? '', encoding) > 0) };
};

export default findPrecompressed;
