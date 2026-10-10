import ResponseEvent from '../classes/ResponseEvent';
import createResponseHeaders from './create-response-headers';

const response = (fields: Partial<ResponseEvent>) => Object.assign(new ResponseEvent(), fields);

describe('createResponseHeaders', () => {
  it('has no headers when the response has none', () => {
    expect(createResponseHeaders(response({ statusCode: 200 }))).toEqual({});
  });

  it('keeps the headers, with numbers as text', () => {
    expect(createResponseHeaders(response({ headers: { 'Content-Type': 'text/plain', 'Content-Length': 5 } }))).toEqual({
      'Content-Type': 'text/plain',
      'Content-Length': '5',
    });
  });

  it('adds the headers of several values to the others, whatever the case of the name', () => {
    const headers = createResponseHeaders(
      response({ headers: { 'X-A': '1', 'Set-Cookie': 'a=1' }, multiValueHeaders: { 'x-a': ['2', '3'], 'set-cookie': ['b=2'] } })
    );

    expect(headers).toEqual({ 'X-A': ['1', '2', '3'], 'Set-Cookie': ['a=1', 'b=2'] });
  });

  it('turns the cookies into Set-Cookie headers', () => {
    expect(createResponseHeaders(response({ cookies: ['a=1', 'b=2'] }))).toEqual({ 'Set-Cookie': ['a=1', 'b=2'] });
    expect(createResponseHeaders(response({ cookies: ['a=1'] }))).toEqual({ 'Set-Cookie': 'a=1' });
  });
});
