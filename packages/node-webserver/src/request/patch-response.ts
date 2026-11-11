import type { Response } from 'express';
import applyHead from './apply-head';
import lowerCaseHeaders from './lower-case-headers';
import type { CompressionDecision, HeaderChanges, HeaderMap, ResponseOutput } from '../types';

type Decide = (statusCode: number, headers: HeaderMap, output: ResponseOutput, bodySize?: number) => CompressionDecision;

/** what was set before with setHeader is changed there */
const applyChanges = (response: Response, changes: HeaderChanges) =>
  Object.entries(changes).forEach(([name, value]) => (value === undefined ? response.removeHeader(name) : response.setHeader(name, value)));

/**
 * Replaces writeHead, write and end of the response, so that `decide` takes the decision when the head is written (by writeHead, or by the first write or
 * end when the headers were only set) and the body goes through the stream it returns, if any.
 */
const patchResponse = (response: Response, decide: Decide) => {
  const { writeHead, write, end } = response;
  const output: ResponseOutput = {
    write: (...args) => Reflect.apply(write, response, args),
    end: (...args) => Reflect.apply(end, response, args),
  };
  const original = { writeHead: (...args: unknown[]) => Reflect.apply(writeHead, response, args), ...output };
  let decided = false;
  let stream: CompressionDecision['stream'];

  const decideAndApply = (statusCode: number, headers: HeaderMap, bodySize?: number) => {
    decided = true;
    const decision = decide(statusCode, headers, output, bodySize);
    stream = decision.stream;
    applyChanges(response, decision.changes);

    return decision.changes;
  };

  /** for the first write or end without writeHead: the head is made of what was set before, then written */
  const writeImplicitHead = (bodySize?: number) => {
    decideAndApply(response.statusCode, lowerCaseHeaders(response.getHeaders()), bodySize);
    response.writeHead(response.statusCode);
  };

  Object.assign(response, {
    writeHead: (statusCode: number, ...rest: unknown[]) => {
      const given = rest.find((argument): argument is HeaderMap => typeof argument === 'object' && argument !== null && !Array.isArray(argument));
      // a list of header names and values is rare and cannot be changed in place
      if (decided || rest.some(Array.isArray)) {
        decided = true;
        return original.writeHead(statusCode, ...rest);
      }

      const changes = decideAndApply(statusCode, { ...lowerCaseHeaders(response.getHeaders()), ...lowerCaseHeaders(given ?? {}) });

      // what was given to writeHead takes precedence over what was set before, so it is changed there as well
      return original.writeHead(statusCode, ...rest.filter((argument) => argument !== given), applyHead(given, changes));
    },
    write: (chunk: unknown, ...rest: unknown[]) => {
      if (!decided) writeImplicitHead();

      return stream ? Reflect.apply(stream.write, stream, [chunk, ...rest]) : original.write(chunk, ...rest);
    },
    end: (chunk?: unknown, ...rest: unknown[]) => {
      if (!decided) writeImplicitHead(typeof chunk === 'string' || Buffer.isBuffer(chunk) ? Buffer.byteLength(chunk) : undefined);

      if (!stream) return original.end(chunk, ...rest);

      return Reflect.apply(stream.end, stream, chunk === undefined || typeof chunk === 'function' ? [chunk] : [chunk, ...rest]);
    },
  } satisfies Partial<Record<keyof Response, unknown>>);
};

export default patchResponse;
