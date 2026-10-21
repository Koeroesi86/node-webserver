import type { RequestHandler } from 'express';
import { asString, chooseEncoding, createCompressionBudget, decideCompression, defaultEncodings, patchResponse } from '../utils';
import type { CompressionBudget, CompressionOptions } from '../types';

/**
 * Compresses the responses that are worth it for the clients that accept it, with the zlib of node: the work runs on the threads of node, not on the one
 * that serves the requests. It takes the decision when the headers are written: text like types, no encoding yet, and a size above the threshold if it is known.
 * The `budget` counts the compressed responses for the `concurrency` option, shared by the middlewares of one server.
 */
const compression =
  (options: CompressionOptions = {}, budget: CompressionBudget = createCompressionBudget()): RequestHandler =>
  (request, response, next) => {
    const encoding = chooseEncoding(asString(request.headers['accept-encoding']), options.encodings ?? defaultEncodings);

    patchResponse(response, (statusCode, headers, output, bodySize) =>
      decideCompression({ request, response, output, encoding, options, budget }, statusCode, headers, bodySize)
    );
    next();
  };

export default compression;
