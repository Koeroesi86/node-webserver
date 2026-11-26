import shareLimit from './share-limit';

const shares = (total: number, count: number) => Array.from({ length: count }, (_, index) => shareLimit(total, { index, count }));

describe('shareLimit', () => {
  it('splits a limit as evenly as possible', () => {
    expect(shares(6, 4)).toEqual([2, 2, 1, 1]);
    expect(shares(8, 4)).toEqual([2, 2, 2, 2]);
  });

  it('keeps 0 as no limit', () => {
    expect(shares(0, 2)).toEqual([0, 0]);
  });

  it('gives every front at least one, so that a share is never no limit', () => {
    expect(shares(1, 3)).toEqual([1, 1, 1]);
  });
});
