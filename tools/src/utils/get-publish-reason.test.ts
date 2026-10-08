import { workspacePackage } from '../test-helpers/packages';
import type { Git } from '../types/version';
import { getPublishReason } from './get-publish-reason';

describe('getPublishReason', () => {
  const dependency = workspacePackage('dependency');
  const item = workspacePackage('item', { dependencies: { dependency: '1' } });
  const packages = [item, dependency];
  const published = { version: '1.0.0', gitHead: 'abcdef1234567' };
  const git = (changed: string[] = [], known = true): Git => ({
    head: 'head',
    isKnownCommit: () => known,
    hasChangesSince: (sha, path) => changed.includes(path),
  });

  it('publishes everything when it is asked to, whatever the state', () => {
    expect(getPublishReason(packages, item, git(), published, true)).toBe('PUBLISH_ALL is set');
  });

  it('publishes a package that never was', () => {
    expect(getPublishReason(packages, item, git(), undefined)).toBe('never published');
  });

  it('publishes when the release does not say which commit it is from', () => {
    expect(getPublishReason(packages, item, git(), { version: '1.0.0' })).toBe('the published release has no gitHead');
  });

  it('publishes when the commit of the release is not in the history', () => {
    expect(getPublishReason(packages, item, git([], false), published)).toBe('the published commit abcdef1 is not in the history');
  });

  it('publishes when the package changed since the release', () => {
    expect(getPublishReason(packages, item, git([item.path]), published)).toBe('changed since abcdef1');
  });

  it('publishes when a package it depends on changed, and names it', () => {
    expect(getPublishReason(packages, item, git([dependency.path]), published)).toBe('dependency changed since abcdef1');
  });

  it('does not publish when nothing changed', () => {
    expect(getPublishReason(packages, item, git(), published)).toBeUndefined();
  });

  it('does not publish a dependency because of a package that depends on it', () => {
    expect(getPublishReason(packages, dependency, git([item.path]), published)).toBeUndefined();
  });
});
