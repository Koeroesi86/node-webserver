import type { Transform } from 'stream';
import type { Response } from 'express';
import { compressionStreams } from './compression-streams';
import type { CompressionBudget, CompressionEncoding, CompressionOptions, ResponseOutput } from '../types';

/** the stream the body goes through, holding a place of the budget until it ends or the client is gone */
const startCompressing = (
  response: Response,
  output: ResponseOutput,
  encoding: CompressionEncoding,
  options: CompressionOptions,
  length: number | undefined,
  budget: CompressionBudget
): Transform => {
  const compressor = compressionStreams[encoding](options, length);
  const release = budget.acquire();

  // the compressed data goes out through the original write, and the source waits when the client does not keep up
  compressor.on('data', (chunk: Buffer) => {
    if (output.write(chunk) === false) compressor.pause();
  });
  compressor.on('end', () => {
    // before the response ends, so that the next request of the client already finds the place free
    release();
    output.end();
  });
  compressor.on('close', release);
  compressor.on('error', () => response.destroy());
  response.on('drain', () => compressor.resume());
  response.on('close', () => compressor.destroy());

  return compressor;
};

export default startCompressing;
