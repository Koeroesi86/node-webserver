import type { Readable } from 'stream';

/** the bytes of a body that arrives as a stream, `undefined` when there are none. Rejects when the stream ends with an error, as when the client goes away. */
const readBodyStream = async (stream: Readable) => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
};

export default readBodyStream;
