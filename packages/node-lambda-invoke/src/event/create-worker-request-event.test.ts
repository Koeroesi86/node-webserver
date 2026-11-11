import { IncomingMessage } from 'http';
import { Socket } from 'net';
import createWorkerRequestEvent from './create-worker-request-event';

const createRequest = (url: string, headers: Record<string, string | string[]> = {}, method = 'get') => {
  const request = new IncomingMessage(new Socket());
  const rawHeaders = Object.entries(headers).flatMap(([name, value]) => (Array.isArray(value) ? value.flatMap((each) => [name, each]) : [name, value]));
  Object.assign(request, { url, method, rawHeaders, httpVersion: '1.1' });
  Object.entries(headers).forEach(([name, value]) => Object.assign(request.headers, { [name.toLowerCase()]: value }));
  return request;
};

describe('createWorkerRequestEvent', () => {
  it('tells the worker the request, with the headers as they were written and the version and the deadline of the lambda', () => {
    const event = createWorkerRequestEvent({ request: createRequest('/users/42?a=1&a=2&b=3', { Host: 'example.test' }, 'post'), deadline: 1234 });

    expect(event).toMatchObject({
      httpMethod: 'POST',
      protocol: 'HTTP',
      path: '/users/42',
      queryStringParameters: { a: ['1', '2'], b: '3' },
      headers: { host: 'example.test' },
      rawHeaders: ['Host', 'example.test'],
      httpVersion: '1.1',
      deadline: 1234,
    });
  });

  it('joins the values of a header that came more than once, as the headers of a request are', () => {
    const { headers } = createWorkerRequestEvent({ request: createRequest('/', { 'Set-Cookie': ['a=1', 'b=2'] }), deadline: 0 });

    expect(headers).toEqual({ 'set-cookie': 'a=1, b=2' });
  });

  it('announces a body when the request has one, by its length or as a stream', () => {
    const announced = (headers: Record<string, string>) => createWorkerRequestEvent({ request: createRequest('/', headers), deadline: 0 }).hasBody;

    expect([announced({ 'Content-Length': '3' }), announced({ 'Transfer-Encoding': 'chunked' }), announced({ 'Content-Length': '0' }), announced({})]).toEqual([
      true,
      true,
      undefined,
      undefined,
    ]);
  });

  it('keeps the path parameters of a route, and does not make some up', () => {
    expect(createWorkerRequestEvent({ request: createRequest('/a'), pathParameters: { id: '1' }, deadline: 0 }).pathParameters).toEqual({ id: '1' });
    expect(createWorkerRequestEvent({ request: createRequest('/a'), deadline: 0 })).not.toHaveProperty('pathParameters');
  });

  it('has an empty query for a request without one, and a root path for an empty url', () => {
    expect(createWorkerRequestEvent({ request: createRequest(''), deadline: 0 })).toMatchObject({ path: '/', queryStringParameters: {} });
  });
});
