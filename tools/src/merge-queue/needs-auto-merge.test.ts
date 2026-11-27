import { createPullRequest } from '../test-helpers/fake-github';
import { needsAutoMerge } from './needs-auto-merge';

const labels = { nodes: [{ name: 'bug' }, { name: 'automerge' }] };

describe('needsAutoMerge', () => {
  it('is true for a pull request with the label and without auto-merge', () => {
    expect(needsAutoMerge(createPullRequest(1, { labels }))).toBe(true);
  });

  it.each([
    ['no label', {}],
    ['another label', { labels: { nodes: [{ name: 'bug' }] } }],
    ['a draft', { labels, isDraft: true }],
    ['a fork', { labels, isCrossRepository: true }],
    ['auto-merge that is on', { labels, autoMergeRequest: { enabledAt: '2026-11-27T10:00:00Z' } }],
  ])('is false for %s', (_case, fields) => {
    expect(needsAutoMerge(createPullRequest(1, fields))).toBe(false);
  });
});
