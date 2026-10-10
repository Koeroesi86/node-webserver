import isValidResponse from './is-valid-response';
import ResponseEvent from '../classes/ResponseEvent';

/** what a lambda can send: anything that survives the trip to the server */
const response = (fields: Record<string, unknown>) => Object.assign(new ResponseEvent(), fields);

describe('isValidResponse', () => {
  it('accepts a status code with or without headers and a body', () => {
    expect(isValidResponse(response({ statusCode: 204 }))).toBe(true);
    expect(isValidResponse(response({ statusCode: 200, headers: { 'x-a': 'b' }, body: 'ok' }))).toBe(true);
    expect(isValidResponse(response({ statusCode: 200, headers: null, body: null }))).toBe(true);
  });

  it('rejects a response without a valid status code', () => {
    expect(isValidResponse(response({}))).toBe(false);
    expect(isValidResponse(response({ statusCode: '200' }))).toBe(false);
    expect(isValidResponse(response({ statusCode: 99 }))).toBe(false);
    expect(isValidResponse(response({ statusCode: 600 }))).toBe(false);
    expect(isValidResponse(response({ statusCode: 200.5 }))).toBe(false);
  });

  it('rejects a body that is not a string, and headers that are not an object', () => {
    expect(isValidResponse(response({ statusCode: 200, body: { a: 1 } }))).toBe(false);
    expect(isValidResponse(response({ statusCode: 200, body: 1 }))).toBe(false);
    expect(isValidResponse(response({ statusCode: 200, headers: 'x' }))).toBe(false);
  });

  it('accepts the headers of several values and the cookies, and rejects them in another shape', () => {
    expect(isValidResponse(response({ statusCode: 200, multiValueHeaders: { 'x-a': ['1', '2'] }, cookies: ['a=b'] }))).toBe(true);
    expect(isValidResponse(response({ statusCode: 200, multiValueHeaders: { 'x-a': '1' } }))).toBe(false);
    expect(isValidResponse(response({ statusCode: 200, cookies: 'a=b' }))).toBe(false);
    expect(isValidResponse(response({ statusCode: 200, cookies: [1] }))).toBe(false);
  });
});
