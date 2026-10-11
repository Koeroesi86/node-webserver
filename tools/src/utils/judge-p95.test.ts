import { judgeP95 } from './judge-p95';

const judged = { subject: 'The p95 of /a', label: 'p95 /a (ms)', maxIncrease: 0.5, minDifferenceMs: 5 };

describe('judgeP95', () => {
  it('passes a p95 within the limit', () => {
    expect(judgeP95({ ...judged, base: 100, head: 120, comparable: true })).toEqual({
      rows: ['| p95 /a (ms) | 100.0 | 120.0 | +20.0% | ✅ |'],
      regressions: [],
    });
  });

  it('reports a p95 that is higher by more than the limit and the minimal difference', () => {
    expect(judgeP95({ ...judged, base: 100, head: 200, comparable: true })).toEqual({
      rows: ['| p95 /a (ms) | 100.0 | 200.0 | +100.0% | ❌ |'],
      regressions: ['The p95 of /a is 100.0% higher than the base (100.0 ms to 200.0 ms), the limit is 50%.'],
    });
  });

  it('does not report a rise of a few milliseconds', () => {
    expect(judgeP95({ ...judged, base: 2, head: 6, comparable: true }).regressions).toEqual([]);
  });

  it('does not judge what the base cannot serve', () => {
    expect(judgeP95({ ...judged, base: undefined, head: 200, comparable: false })).toEqual({
      rows: ['| p95 /a (ms) | n/a | 200.0 | the base cannot serve it | ➖ |'],
      regressions: [],
    });
  });
});
