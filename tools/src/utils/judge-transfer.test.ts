import { defaultLimits } from '../constants/comparison-limits';
import { transferRuns } from '../test-helpers/summaries';
import { judgeTransfer } from './judge-transfer';

describe('judgeTransfer', () => {
  const judge = (base: ReturnType<typeof transferRuns>, head: ReturnType<typeof transferRuns>) =>
    judgeTransfer({
      subject: 'The speed of the big uploads',
      label: 'big uploads, median speed (MB/s)',
      metric: 'big_upload_mb_per_s',
      checks: 'checks{route:big-upload}',
      baseRuns: base,
      headRuns: head,
      limits: defaultLimits,
    });

  it('finds no regression with the same speed', () => {
    const { rows, regressions } = judge(transferRuns(3), transferRuns(3));

    expect(regressions).toEqual([]);
    expect(rows).toEqual(['| big uploads, median speed (MB/s) | 500 | 500 | +0.0% | ✅ |']);
  });

  it('shows a gain without judging it', () => {
    const { rows, regressions } = judge(transferRuns(3, { speed: 400 }), transferRuns(3, { speed: 520 }));

    expect(regressions).toEqual([]);
    expect(rows).toEqual(['| big uploads, median speed (MB/s) | 400 | 520 | +30.0% | ✅ |']);
  });

  it('is a regression when the pull request is more than 15% slower', () => {
    const { rows, regressions } = judge(transferRuns(3, { speed: 500 }), transferRuns(3, { speed: 400 }));

    expect(regressions).toEqual(['The speed of the big uploads is 20.0% lower than the base (500 MB/s to 400 MB/s), the limit is 15%.']);
    expect(rows[0]).toContain('❌');
  });

  it('is not when it is 10% slower', () => {
    expect(judge(transferRuns(3, { speed: 500 }), transferRuns(3, { speed: 450 })).regressions).toEqual([]);
  });

  it('takes the median of the runs, so that one slow run does not decide', () => {
    const base = [500, 510, 490].map((speed) => transferRuns(1, { speed })[0]);
    const head = [500, 200, 505].map((speed) => transferRuns(1, { speed })[0]);

    expect(judge(base, head).regressions).toEqual([]);
  });

  it('is a regression when the pull request produced no speed at all', () => {
    const { regressions } = judge(transferRuns(3), [{ metrics: {} }]);

    expect(regressions).toEqual([expect.stringContaining('lower than the base')]);
  });

  it('is not judged when the base cannot serve it', () => {
    const { rows, regressions } = judge(transferRuns(3, { speed: 900, checkRate: 0 }), transferRuns(3, { speed: 100 }));

    expect(regressions).toEqual([]);
    expect(rows).toEqual(['| big uploads, median speed (MB/s) | n/a | 100 | the base cannot serve it | ➖ |']);
  });

  it('is not judged when the base has no such scenario', () => {
    const { rows, regressions } = judge([{ metrics: {} }], transferRuns(3));

    expect(regressions).toEqual([]);
    expect(rows[0]).toContain('➖');
  });
});
