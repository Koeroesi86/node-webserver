import express from 'express';
import http2 from 'http2';
import type { Express } from 'express';
import type { IncomingHttpHeaders } from 'http';

/** what HTTP/2 does not have, as the streams of a connection are not one by one: node throws when a response has one of them, which would end the process from inside a handler */
const connectionHeaders = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade'];
const withoutConnectionHeaders = (headers: object) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !connectionHeaders.includes(name.toLowerCase())));
const http2WriteHead = http2.Http2ServerResponse.prototype.writeHead;
const http2Headers = Object.getOwnPropertyDescriptor(http2.Http2ServerRequest.prototype, 'headers')?.get;
/** the headers of a request as the handlers see them, made once per request */
const headersOf = new WeakMap<object, IncomingHttpHeaders>();

/**
 * The headers of an HTTP/2 request the way they are in HTTP/1: the name of the host in `host`, which HTTP/2 sends as `:authority`, and without the pseudo headers
 * (`:method`, `:path`, ...), which the workers and lambdas have no use for and which a proxied request cannot carry. The request itself keeps them, its url and method are read from there.
 */
function headers(this: http2.Http2ServerRequest): IncomingHttpHeaders {
  const known = headersOf.get(this);
  if (known) return known;

  const original: IncomingHttpHeaders = http2Headers?.call(this) ?? {};
  const { ':authority': authority, host = authority } = original;
  const plain = Object.fromEntries(Object.entries(original).filter(([name]) => !name.startsWith(':')));
  const made: IncomingHttpHeaders = host === undefined ? plain : { ...plain, host };
  headersOf.set(this, made);

  return made;
}

/** the head of a response without the headers that only HTTP/1 has: a worker or a proxied application does not know which version the client speaks */
function writeHead(this: http2.Http2ServerResponse, statusCode: number, ...rest: unknown[]) {
  connectionHeaders.forEach((name) => this.removeHeader(name));
  const given = rest.map((argument) =>
    typeof argument === 'object' && argument !== null && !Array.isArray(argument) ? withoutConnectionHeaders(argument) : argument
  );

  return Reflect.apply(http2WriteHead, this, [statusCode, ...given]);
}

/** the prototype of express, `request` or `response`, on top of a class of HTTP/2 instead of the one of HTTP/1 it is made for */
const onTopOf = (prototype: object, expressPrototype: object, app: Express, extra: PropertyDescriptorMap = {}) =>
  Object.create(Object.create(prototype, { ...Object.getOwnPropertyDescriptors(expressPrototype), ...extra }), {
    app: { configurable: true, enumerable: true, writable: true, value: app },
  });

/**
 * An express app for the requests of HTTP/2. Express makes every request and response an instance of its own classes, which are built on the ones of HTTP/1,
 * and the objects of the compatibility layer of HTTP/2 do not work that way: reading the body fails in `IncomingMessage._read`. So this app has the same
 * methods on top of the classes of HTTP/2. The handlers are shared with the app of HTTP/1 through a router, which keeps one worker pool per server.
 */
const createHttp2App = (): Express => {
  const app = express();
  app.disable('x-powered-by');
  app.request = onTopOf(http2.Http2ServerRequest.prototype, express.request, app, { headers: { configurable: true, enumerable: true, get: headers } });
  app.response = onTopOf(http2.Http2ServerResponse.prototype, express.response, app, { writeHead: { configurable: true, writable: true, value: writeHead } });

  return app;
};

export default createHttp2App;
