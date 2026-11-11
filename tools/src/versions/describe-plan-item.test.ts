import { workspacePackage } from '../test-helpers/packages';
import { describePlanItem } from './describe-plan-item';

describe('describePlanItem', () => {
  const item = workspacePackage('@scope/a');

  it('names the new version and the reason for a package that changed', () => {
    expect(describePlanItem({ item, reason: 'never published' }, '26.10.1-main')).toBe('@scope/a: 26.10.1-main (never published)');
  });

  it('names the published version for one that did not', () => {
    expect(describePlanItem({ item, published: { version: '25.1.1-old' } }, '26.10.1-main')).toBe('@scope/a: 25.1.1-old (unchanged, already published)');
  });
});
