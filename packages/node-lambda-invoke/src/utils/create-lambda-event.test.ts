import { IncomingMessage } from 'http';
import { Socket } from 'net';
import type { WorkerRequestEvent } from '@koeroesi86/node-worker-pool';
import createLambdaEvent from './create-lambda-event';
import createWorkerRequestEvent from './create-worker-request-event';
import parseQueryString from './parse-query-string';

const createRequest = (url: string, rawHeaders: string[] = [], method = 'get') => {
  const request = new IncomingMessage(new Socket());
  Object.assign(request, { url, method, rawHeaders });
  rawHeaders.forEach((value, index) => {
    if (index % 2 === 1) return;
    const name = value.toLowerCase();
    const existing = request.headers[name];
    Object.assign(request.headers, { [name]: existing === undefined ? rawHeaders[index + 1] : `${existing}, ${rawHeaders[index + 1]}` });
  });
  return request;
};

/** the event of API Gateway the way a lambda gets it: the front makes the worker event of the request, the worker process makes the event of it */
const eventOf = (request: IncomingMessage, requestId: string, body?: Buffer, pathParameters?: Record<string, string>) => {
  const workerEvent: WorkerRequestEvent = {
    ...createWorkerRequestEvent({ request, pathParameters, deadline: 0 }),
    requestId,
    bodyStream: jest.fn() as never,
    getMetrics: jest.fn(),
  };

  return createLambdaEvent(workerEvent, body);
};

describe('createLambdaEvent', () => {
  it('has the fields of the event of API Gateway', () => {
    const event = eventOf(createRequest('/users/42?a=1&a=2', ['Host', 'example.test', 'User-Agent', 'curl'], 'post'), 'id-1', Buffer.from('hello'));

    expect(event).toMatchObject({
      resource: '/{proxy+}',
      path: '/users/42',
      httpMethod: 'POST',
      headers: { Host: 'example.test', 'User-Agent': 'curl' },
      multiValueHeaders: { Host: ['example.test'], 'User-Agent': ['curl'] },
      queryStringParameters: { a: '2' },
      multiValueQueryStringParameters: { a: ['1', '2'] },
      pathParameters: { proxy: 'users/42' },
      stageVariables: null,
      body: 'hello',
      isBase64Encoded: false,
      requestContext: { requestId: 'id-1', httpMethod: 'POST', path: '/users/42', domainName: 'example.test', identity: { userAgent: 'curl' } },
    });
  });

  it('keeps the headers as the client wrote them, and every value of a header that came more than once', () => {
    const event = eventOf(createRequest('/', ['X-Forwarded-For', '1.1.1.1', 'Accept', 'a', 'x-forwarded-for', '2.2.2.2']), 'id');

    expect(event.headers).toEqual({ 'X-Forwarded-For': '2.2.2.2', Accept: 'a' });
    expect(event.multiValueHeaders).toEqual({ 'X-Forwarded-For': ['1.1.1.1', '2.2.2.2'], Accept: ['a'] });
  });

  it('has the same query parameters as before the request went through the worker protocol', () => {
    const queries = ['', 'a=1&b=2&a=3', 'a%20b=c%26d&flag', 'a=&a=', 'q=a+b&q=%E2%9C%93', '__proto__=x&constructor=y&__proto__=z'];

    queries.forEach((query) => {
      const { single, multi } = parseQueryString(query);
      const event = eventOf(createRequest(`/?${query}`), 'id');

      expect([event.queryStringParameters, event.multiValueQueryStringParameters]).toEqual([single, multi]);
    });
  });

  it('passes the parameters of a route instead of the proxy path', () => {
    const event = eventOf(createRequest('/orders/42'), 'id-4', undefined, { id: '42' });

    expect(event.pathParameters).toEqual({ id: '42' });
    expect(event.resource).toBe('/{proxy+}');
  });

  it('has nulls where there is nothing, like API Gateway', () => {
    const event = eventOf(createRequest('/'), 'id-2');

    expect(event).toMatchObject({
      resource: '/',
      path: '/',
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      body: null,
      isBase64Encoded: false,
    });
  });

  it('tells the protocol and the address of the client', () => {
    const request = createRequest('/');
    Object.assign(request, { httpVersion: '1.1' });
    Object.defineProperty(request.socket, 'remoteAddress', { value: '10.0.0.7' });

    expect(eventOf(request, 'id').requestContext).toMatchObject({ protocol: 'HTTP/1.1', identity: { sourceIp: '10.0.0.7' } });
  });

  it('passes a body that is not valid UTF-8 as base64', () => {
    const event = eventOf(createRequest('/'), 'id-3', Buffer.from([0, 1, 255]));

    expect(event).toMatchObject({ body: Buffer.from([0, 1, 255]).toString('base64'), isBase64Encoded: true });
  });

  it('keeps an empty path and does not mistake a path that starts with two slashes for a host', () => {
    expect(eventOf(createRequest(''), 'id').path).toBe('/');
    expect(eventOf(createRequest('//a/b?x=1'), 'id')).toMatchObject({ path: '//a/b', queryStringParameters: { x: '1' } });
  });
});
