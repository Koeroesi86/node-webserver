import { createVersion } from './create-version';

describe('createVersion', () => {
  it('is the year, the month, the run and the branch', () => {
    expect(createVersion(new Date(2026, 9, 8), '123', 'main')).toBe('26.10.123-main');
  });

  it('pads the month and keeps the branch name usable in a version', () => {
    expect(createVersion(new Date(2027, 0, 1), '7', 'feature/load-test')).toBe('27.01.7-feature-load-test');
  });
});
