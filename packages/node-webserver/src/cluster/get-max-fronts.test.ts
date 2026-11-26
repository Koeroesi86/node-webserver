import getMaxFronts from './get-max-fronts';

describe('getMaxFronts', () => {
  it.each([
    [1, 1],
    [3, 3],
    [4, 4],
    [64, 4],
  ])('is the cores, at most 4: %i cores give %i', (cores, fronts) => {
    expect(getMaxFronts(cores)).toBe(fronts);
  });
});
