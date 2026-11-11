import parseQueryString from './parse-query-string';

describe('parseQueryString', () => {
  it('has no parameters as null, the way API Gateway has', () => {
    expect(parseQueryString('')).toEqual({ single: null, multi: null });
  });

  it('keeps the last value of a repeated parameter, and all of them in the multi value form', () => {
    expect(parseQueryString('a=1&b=2&a=3')).toEqual({ single: { a: '3', b: '2' }, multi: { a: ['1', '3'], b: ['2'] } });
  });

  it('decodes the names and values, and gives a parameter without a value an empty string', () => {
    expect(parseQueryString('a%20b=c%26d&flag')).toEqual({ single: { 'a b': 'c&d', flag: '' }, multi: { 'a b': ['c&d'], flag: [''] } });
  });

  it('does not let a parameter named like a property of an object change the result', () => {
    const { single } = parseQueryString('__proto__=x&constructor=y');

    expect(Object.keys(single ?? {}).sort()).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(single)).toBe(Object.prototype);
  });
});
