import { lowest } from './lowest';

describe('lowest', () => {
  it('is the lowest of the values that are there', () => {
    expect(lowest([12, undefined, 7.5, 30])).toBe(7.5);
  });

  it('is undefined when no value is there', () => {
    expect(lowest([])).toBeUndefined();
    expect(lowest([undefined])).toBeUndefined();
  });
});
