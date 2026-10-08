import { spread } from './spread';

describe('spread', () => {
  it('is the lowest and the highest value', () => {
    expect(spread([3, 1, 2])).toEqual({ min: 1, max: 3 });
  });

  it('leaves out what is not known, and is not known for nothing', () => {
    expect(spread([undefined, 5, undefined])).toEqual({ min: 5, max: 5 });
    expect(spread([])).toBeUndefined();
    expect(spread([undefined])).toBeUndefined();
  });
});
