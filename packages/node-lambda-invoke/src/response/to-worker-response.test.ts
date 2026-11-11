import { ResponseEvent } from '../classes';
import toWorkerResponse from './to-worker-response';

const response = (fields: Partial<ResponseEvent>) => Object.assign(new ResponseEvent(), fields);

describe('toWorkerResponse', () => {
  it('sends the body as bytes, utf8 or base64 as the response says', () => {
    expect(toWorkerResponse(response({ statusCode: 200, body: 'héllo' })).body).toEqual(Buffer.from('héllo'));
    expect(toWorkerResponse(response({ statusCode: 200, body: Buffer.from([0, 255]).toString('base64'), isBase64Encoded: true })).body).toEqual(
      Buffer.from([0, 255])
    );
  });

  it('has no body for a response without one', () => {
    expect(toWorkerResponse(response({ statusCode: 204 }))).toMatchObject({ statusCode: 204, body: undefined });
  });

  it('merges the headers, the headers of several values and the cookies, a header with several values as an array', () => {
    const { headers } = toWorkerResponse(response({ statusCode: 200, headers: { 'X-A': '1' }, multiValueHeaders: { 'x-a': ['2'] }, cookies: ['a=1', 'b=2'] }));

    expect(headers).toEqual({ 'X-A': ['1', '2'], 'Set-Cookie': ['a=1', 'b=2'] });
  });

  it.each([[{}], [{ statusCode: 99 }], [{ statusCode: 200, body: { an: 'object' } }], [{ statusCode: 200, cookies: 'a=1' }]])(
    'answers a malformed response (%j) the way API Gateway does, with 502 and a JSON message',
    (fields) => {
      expect(toWorkerResponse(response(fields as Partial<ResponseEvent>))).toEqual({
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: '{"message":"Internal server error"}',
      });
    }
  );
});
