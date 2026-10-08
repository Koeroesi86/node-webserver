import { workspacePackage } from '../test-helpers/packages';
import { getWorkspaceDependencies } from './get-workspace-dependencies';

describe('getWorkspaceDependencies', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((name) => workspacePackage(name));

  it('finds the dependencies, optional ones and peers that are packages of the workspace', () => {
    const item = workspacePackage('x', { dependencies: { a: '1' }, optionalDependencies: { b: '1' }, peerDependencies: { c: '1' } });

    expect(getWorkspaceDependencies([a, b, c, d], item)).toEqual([a, b, c]);
  });

  it('leaves out what is not in the workspace', () => {
    expect(getWorkspaceDependencies([a], workspacePackage('x', { dependencies: { a: '1', lodash: '4' } }))).toEqual([a]);
  });

  it('is empty without dependencies', () => {
    expect(getWorkspaceDependencies([a], workspacePackage('x'))).toEqual([]);
  });
});
