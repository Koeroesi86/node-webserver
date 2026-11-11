import parseRawHeaders from './parse-raw-headers';

describe('parseRawHeaders', () => {
  it('keeps the names the way the client wrote them', () => {
    expect(parseRawHeaders(['Host', 'localhost', 'X-Custom-Header', 'a']).headers).toEqual({ Host: 'localhost', 'X-Custom-Header': 'a' });
  });

  it('keeps the last value of a header that came more than once, and all of them in the multi value form', () => {
    const { headers, multiValueHeaders } = parseRawHeaders(['X-Many', 'a', 'x-many', 'b', 'Other', 'c']);

    expect(headers).toEqual({ 'X-Many': 'b', Other: 'c' });
    expect(multiValueHeaders).toEqual({ 'X-Many': ['a', 'b'], Other: ['c'] });
  });

  it('ignores a name without a value', () => {
    expect(parseRawHeaders(['Lonely'])).toEqual({ headers: {}, multiValueHeaders: {} });
  });
});
