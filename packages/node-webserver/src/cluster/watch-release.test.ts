import watchRelease from './watch-release';
import { RELEASE_CHECK_INTERVAL, RELEASE_MAX_GAP, RELEASE_SETTLE_LOOKS } from '../constants';

describe('watchRelease', () => {
  let installed: string;
  const read = jest.fn(() => installed);
  const onChange = jest.fn();
  let stop: () => void;
  const looks = (count: number) => jest.advanceTimersByTime(count * RELEASE_CHECK_INTERVAL);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    installed = 'one';
    stop = watchRelease({ running: 'one', read, onChange });
  });

  afterEach(() => {
    stop();
    jest.useRealTimers();
  });

  it('says nothing while the versions are the ones that run', () => {
    looks(100);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports other versions once they stayed the same for a few looks', () => {
    installed = 'two';

    looks(RELEASE_SETTLE_LOOKS);
    expect(onChange).not.toHaveBeenCalled();
    looks(1);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('starts over while the versions still change, or cannot be read', () => {
    installed = 'two';
    looks(RELEASE_SETTLE_LOOKS);
    installed = 'three';
    looks(RELEASE_SETTLE_LOOKS);
    read.mockImplementationOnce(() => {
      throw new Error('half written');
    });
    looks(RELEASE_SETTLE_LOOKS + 1);
    expect(onChange).not.toHaveBeenCalled();

    looks(1);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reports them again after ever longer gaps, up to a longest one', () => {
    installed = 'two';
    const at: number[] = [];
    onChange.mockImplementation(() => at.push(Date.now()));
    const start = Date.now();

    looks(RELEASE_MAX_GAP * 5);

    const gaps = at.map((time, index) => (time - (at[index - 1] ?? start)) / RELEASE_CHECK_INTERVAL);
    expect(gaps.slice(0, 4)).toEqual([RELEASE_SETTLE_LOOKS + 1, RELEASE_SETTLE_LOOKS, 2 * RELEASE_SETTLE_LOOKS, 4 * RELEASE_SETTLE_LOOKS]);
    expect(Math.max(...gaps)).toBe(RELEASE_MAX_GAP);
  });

  it('looks no more once it is stopped', () => {
    stop();
    installed = 'two';

    looks(100);

    expect(read).not.toHaveBeenCalled();
  });
});
