import { workspacePackage } from '../test-helpers/packages';
import { stampPackage } from './stamp-package';

describe('stampPackage', () => {
  const item = workspacePackage('@scope/a', { version: '1.0.0', description: 'kept' });

  it('gives a package that changed the new version and the commit', () => {
    expect(stampPackage({ item, reason: 'changed since abc1234' }, '26.10.1-main', 'head-sha')).toEqual({
      name: '@scope/a',
      description: 'kept',
      version: '26.10.1-main',
      gitHead: 'head-sha',
    });
  });

  it('gives a package that did not change the published version, and leaves its commit alone', () => {
    expect(stampPackage({ item, published: { version: '25.1.1-old', gitHead: 'old' } }, '26.10.1-main', 'head-sha')).toEqual({
      name: '@scope/a',
      description: 'kept',
      version: '25.1.1-old',
    });
  });
});
