import { workspacePackage } from '../test-helpers/packages';
import { getPackageFamily } from './get-package-family';

describe('getPackageFamily', () => {
  it('is the package and all its dependencies, down the chain', () => {
    const c = workspacePackage('c');
    const b = workspacePackage('b', { dependencies: { c: '1' } });
    const a = workspacePackage('a', { dependencies: { b: '1' } });
    const other = workspacePackage('other');

    expect([...getPackageFamily([a, b, c, other], a)]).toEqual([a, b, c]);
  });

  it('is only the package without dependencies', () => {
    const a = workspacePackage('a');

    expect([...getPackageFamily([a], a)]).toEqual([a]);
  });

  it('does not loop on packages that depend on each other', () => {
    const a = workspacePackage('a', { dependencies: { b: '1' } });
    const b = workspacePackage('b', { dependencies: { a: '1' } });

    expect([...getPackageFamily([a, b], a)]).toEqual([a, b]);
  });
});
