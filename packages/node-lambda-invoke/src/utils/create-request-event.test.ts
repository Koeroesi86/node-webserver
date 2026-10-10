import { IncomingMessage } from 'http';
import { Socket } from 'net';
import createRequestEvent from './create-request-event';

const createRequest = (url: string, rawHeaders: string[] = [], method = 'get') => {
  const request = new IncomingMessage(new Socket());
  Object.assign(request, { url, method, rawHeaders });
  rawHeaders.forEach((value, index) => index % 2 === 0 && Object.assign(request.headers, { [value.toLowerCase()]: rawHeaders[index + 1] }));
  return request;
};

describe('createRequestEvent', () => {
  it('has the fields of the event of API Gateway', () => {
    const event = createRequestEvent(createRequest('/users/42?a=1&a=2', ['Host', 'example.test', 'User-Agent', 'curl'], 'post'), 'id-1', Buffer.from('hello'));

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

  it('passes the parameters of a route instead of the proxy path', () => {
    const event = createRequestEvent(createRequest('/orders/42'), 'id-4', undefined, { id: '42' });

    expect(event.pathParameters).toEqual({ id: '42' });
    expect(event.resource).toBe('/{proxy+}');
  });

  it('has nulls where there is nothing, like API Gateway', () => {
    const event = createRequestEvent(createRequest('/'), 'id-2');

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

  it('passes a body that is not valid UTF-8 as base64', () => {
    const event = createRequestEvent(createRequest('/'), 'id-3', Buffer.from([0, 1, 255]));

    expect(event).toMatchObject({ body: Buffer.from([0, 1, 255]).toString('base64'), isBase64Encoded: true });
  });

  it('keeps an empty path and does not mistake a path that starts with two slashes for a host', () => {
    expect(createRequestEvent(createRequest(''), 'id').path).toBe('/');
    expect(createRequestEvent(createRequest('//a/b?x=1'), 'id')).toMatchObject({ path: '//a/b', queryStringParameters: { x: '1' } });
  });
});
