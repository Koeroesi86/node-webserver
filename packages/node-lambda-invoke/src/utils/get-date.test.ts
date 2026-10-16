import getDate from './get-date';

describe('getDate', () => {
  it('is the local time with hundredths of a second', () => {
    expect(getDate(new Date(2026, 9, 7, 14, 5, 9, 370))).toBe('2026-10-07 14:05:09.37');
  });

  it('cuts the milliseconds instead of rounding them', () => {
    const base = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();

    expect([9, 10, 994, 999].map((offset) => getDate(new Date(base + offset)).slice(-2))).toEqual(['00', '01', '99', '99']);
  });

  it('pads every part', () => {
    expect(getDate(new Date(2026, 0, 2, 3, 4, 5, 60))).toBe('2026-01-02 03:04:05.06');
  });

  it('pads a year before 1000 to four digits', () => {
    const date = new Date(2026, 0, 1);
    date.setFullYear(999);

    expect(getDate(date).slice(0, 4)).toBe('0999');
  });
});
