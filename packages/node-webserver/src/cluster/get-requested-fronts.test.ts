import getRequestedFronts from './get-requested-fronts';

describe('getRequestedFronts', () => {
  it('is the most the cores allow without the setting, as for auto', () => {
    expect([1, 2, 8].map((cores) => getRequestedFronts({}, cores))).toEqual([1, 2, 4]);
  });

  it('is the number of the setting', () => {
    expect(getRequestedFronts({ frontProcesses: 3 }, 8)).toBe(3);
  });

  it('is the most the cores allow for auto', () => {
    expect([1, 2, 8].map((cores) => getRequestedFronts({ frontProcesses: 'auto' }, cores))).toEqual([1, 2, 4]);
  });

  it('is never above what the cores allow, which the check of the configuration reports', () => {
    expect(getRequestedFronts({ frontProcesses: 4 }, 2)).toBe(2);
  });
});
