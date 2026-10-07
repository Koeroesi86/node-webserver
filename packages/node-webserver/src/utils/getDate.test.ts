import moment from 'moment';
import getDate from './getDate';

describe('getDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const at = (time: number | string) => {
    jest.setSystemTime(new Date(time));

    return getDate();
  };

  it('is the local time with hundredths of a second', () => {
    expect(at(new Date(2026, 9, 7, 14, 5, 9, 370).getTime())).toBe('2026-10-07 14:05:09.37');
  });

  it('gives the same as the format that moment gave, for many moments of the year, in every time zone', () => {
    const start = new Date(2025, 0, 1).getTime();
    // a prime step, to meet all milliseconds, hours and days, including the changes of the clocks
    const times = Array.from({ length: 4000 }, (_, index) => start + index * 7919123);

    times.forEach((time) => {
      jest.setSystemTime(time);
      expect(getDate()).toBe(moment().format('YYYY-MM-DD HH:mm:ss.SS'));
    });
  });

  it('cuts the milliseconds instead of rounding them', () => {
    const base = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();

    expect([base + 9, base + 10, base + 994, base + 999].map(at).map((date) => date.slice(-2))).toEqual(['00', '01', '99', '99']);
  });

  it('pads every part', () => {
    expect(at(new Date(2026, 0, 2, 3, 4, 5, 60).getTime())).toBe('2026-01-02 03:04:05.06');
  });

  it('changes with the second and with the day', () => {
    const first = at(new Date(2026, 11, 31, 23, 59, 59, 990).getTime());
    const second = at(new Date(2026, 11, 31, 23, 59, 59, 990).getTime() + 20);

    expect([first, second]).toEqual(['2026-12-31 23:59:59.99', '2027-01-01 00:00:00.01']);
  });

  it('goes back when the clock does', () => {
    at(new Date(2026, 5, 1, 12, 0, 30, 0).getTime());

    expect(at(new Date(2026, 5, 1, 12, 0, 10, 500).getTime())).toBe('2026-06-01 12:00:10.50');
  });

  it('does not work out the date again for lines in the same second', () => {
    jest.setSystemTime(new Date(2026, 5, 1, 12, 0, 10, 0));
    getDate();
    const getHours = jest.spyOn(Date.prototype, 'getHours');

    Array.from({ length: 50 }, () => getDate());

    expect(getHours).not.toHaveBeenCalled();
    getHours.mockRestore();
  });
});
