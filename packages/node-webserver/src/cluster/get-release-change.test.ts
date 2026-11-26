import getReleaseChange from './get-release-change';

const running = { configuration: 'a', version: '1.0.0' };

describe('getReleaseChange', () => {
  it('is nothing for the same release', () => {
    expect(getReleaseChange(running, { ...running })).toBeUndefined();
  });

  it('names another version', () => {
    expect(getReleaseChange(running, { configuration: 'b', version: '2.0.0' })).toContain('version 2.0.0');
  });

  it('names another configuration', () => {
    expect(getReleaseChange(running, { ...running, configuration: 'b' })).toContain('configuration');
  });
});
