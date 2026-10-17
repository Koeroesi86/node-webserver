import { formatNumber } from './format-number';

describe('formatNumber', () => {
  it('rounds to the digits', () => {
    expect(formatNumber(1234.567)).toBe('1235');
    expect(formatNumber(1234.567, 1)).toBe('1234.6');
  });

  it('says n/a when it is not known', () => {
    expect(formatNumber(undefined)).toBe('n/a');
    expect(formatNumber(JSON.parse('null'))).toBe('n/a');
    expect(formatNumber(Infinity)).toBe('n/a');
  });
});
