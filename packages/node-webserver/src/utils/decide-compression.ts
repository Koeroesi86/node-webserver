import type { Request, Response } from 'express';
import { COMPRESSIBLE_TYPES } from '../constants';
import asString from './as-string';
import isOpenToEncoding from './is-open-to-encoding';
import startCompressing from './start-compressing';
import varyOnEncoding from './vary-on-encoding';
import type { CompressionBudget, CompressionDecision, CompressionEncoding, CompressionOptions, HeaderMap, ResponseOutput } from '../types';

interface Context {
  request: Request;
  response: Response;
  output: ResponseOutput;
  /** what the client accepts and the options allow, `undefined` when nothing fits */
  encoding?: CompressionEncoding;
  options: CompressionOptions;
  budget: CompressionBudget;
}

/** whether the answer is compressed and the headers to change for it: `headers` are what is about to be sent, `bodySize` the size of a body that came with the end */
const decideCompression = (context: Context, statusCode: number, headers: HeaderMap, bodySize?: number): CompressionDecision => {
  const { request, response, output, encoding, options, budget } = context;
  const { threshold = 1024, concurrency = 0 } = options;
  const type = asString(headers['content-type']).split(';')[0].trim();
  const declared = headers['content-length'] === undefined ? bodySize : Number(headers['content-length']);
  const length = Number.isNaN(declared) ? undefined : declared;
  const isCompressible = COMPRESSIBLE_TYPES.test(type);
  const varied = varyOnEncoding(isCompressible, asString(headers.vary));
  const mayCompress =
    encoding !== undefined &&
    isCompressible &&
    request.method !== 'HEAD' &&
    isOpenToEncoding(statusCode, headers) &&
    (length === undefined || length >= threshold) &&
    (concurrency === 0 || budget.getActive() < concurrency);

  if (!mayCompress) return { changes: varied };

  const etag = asString(headers.etag);
  // the size is not known any more, and a strong validator would promise the same bytes as the uncompressed answer
  const weakened = etag && !etag.startsWith('W/') ? { ETag: `W/${etag}` } : {};

  return {
    changes: { ...varied, 'Content-Encoding': encoding, 'Content-Length': undefined, ...weakened },
    stream: startCompressing(response, output, encoding, options, length, budget),
  };
};

export default decideCompression;
