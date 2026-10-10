import createWorkerBudget from './create-worker-budget';
import type { IdleWorker, WorkerBudgetMember } from '../types';

const member = (count: number, idle?: IdleWorker): WorkerBudgetMember => ({ getWorkerCount: () => count, findIdleWorker: () => idle, wakeUp: jest.fn() });

describe('createWorkerBudget', () => {
  it('has room while the workers of its members together are below the limit', () => {
    const budget = createWorkerBudget(3);
    budget.join(member(1));
    budget.join(member(1));

    expect(budget.hasRoom()).toBe(true);
    budget.join(member(1));
    expect(budget.hasRoom()).toBe(false);
    expect(budget.getStats()).toEqual({ limit: 3, workers: 3 });
  });

  it('stops counting a member that left', () => {
    const budget = createWorkerBudget(2);
    const leaving = member(1);
    budget.join(member(1));
    budget.join(leaving);
    budget.leave(leaving);

    expect(budget.hasRoom()).toBe(true);
    expect(budget.getStats()).toEqual({ limit: 2, workers: 1 });
  });

  it('always has room with a limit of 0', () => {
    const budget = createWorkerBudget();
    budget.join(member(1000));

    expect(budget.hasRoom()).toBe(true);
  });

  it('finds the idle worker of all its members that goes first', () => {
    const budget = createWorkerBudget(2);
    const oldest = { spare: false, lastUsed: 1000, stop: () => {} };
    budget.join(member(1, { spare: false, lastUsed: 2000, stop: () => {} }));
    budget.join(member(1));
    budget.join(member(1, oldest));

    expect(budget.findIdleWorker()).toBe(oldest);
  });

  it('wakes up the members other than the one that asks', () => {
    const budget = createWorkerBudget(2);
    const members = [member(0), member(0), member(0)];
    members.forEach(budget.join);

    budget.wakeUp(members[1]);

    expect(members.map((current) => (current.wakeUp as jest.Mock).mock.calls.length)).toEqual([1, 0, 1]);
  });
});
