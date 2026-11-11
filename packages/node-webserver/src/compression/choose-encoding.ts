import type { CompressionEncoding } from '../types';

/** The encoding to use: what the client accepts with the highest weight, the order of the options settles ties. */
const chooseEncoding = (acceptEncoding: string, supported: CompressionEncoding[]): CompressionEncoding | undefined => {
  const weights = new Map<string, number>(
    acceptEncoding
      .toLowerCase()
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...parameters] = part.split(';').map((piece) => piece.trim());
        const weight = parameters.find((parameter) => parameter.startsWith('q='))?.slice(2);

        return [name, weight === undefined ? 1 : Number(weight) || 0];
      })
  );
  const weightOf = (encoding: CompressionEncoding) => weights.get(encoding) ?? weights.get('*') ?? 0;

  return supported
    .filter((encoding) => weightOf(encoding) > 0)
    .map((encoding, index) => ({ encoding, index }))
    .sort((a, b) => weightOf(b.encoding) - weightOf(a.encoding) || a.index - b.index)[0]?.encoding;
};

export default chooseEncoding;
