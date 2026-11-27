import describeVersionChange from './describe-version-change';

describe('describeVersionChange', () => {
  it('names the packages that differ only', () => {
    expect(describeVersionChange('a@1 b@2 c@3', 'a@1 b@2.1 c@3')).toBe('b@2.1 now, instead of b@2');
  });
});
