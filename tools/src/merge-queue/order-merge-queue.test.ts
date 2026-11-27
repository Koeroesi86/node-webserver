import { createPullRequest } from '../test-helpers/fake-github';
import { orderMergeQueue } from './order-merge-queue';

const queued = (number: number, enabledAt: string) => createPullRequest(number, { autoMergeRequest: { enabledAt } });

describe('orderMergeQueue', () => {
  it('orders by when auto-merge was enabled, not by the number', () => {
    const pullRequests = [queued(1, '2026-11-02T10:00:00Z'), queued(2, '2026-11-02T08:00:00Z'), queued(3, '2026-11-02T09:00:00Z')];

    expect(orderMergeQueue(pullRequests).map(({ number }) => number)).toEqual([2, 3, 1]);
  });

  it('leaves out the pull requests without auto-merge, and keeps the ones with a conflict', () => {
    const conflicting = { ...queued(2, '2026-11-02T08:00:00Z'), mergeable: 'CONFLICTING' as const };

    expect(orderMergeQueue([createPullRequest(1), conflicting])).toEqual([conflicting]);
  });
});
