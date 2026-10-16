import asString from './as-string';

describe('asString', () => {
  it.each([
    ['text', 'text'],
    [['a', 'b'], 'a, b'],
    [5, '5'],
    [undefined, ''],
    [null, ''],
  ])('turns %j into %j', (value, expected) => {
    expect(asString(value)).toBe(expected);
  });
});
