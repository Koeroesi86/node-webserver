import type { WorkerBudget, WorkerBudgetMember } from '../types';
import pickIdleWorker from './pick-idle-worker';

/** A limit on the workers of all the pools that join it, 0 for no limit. Give the same one to the middleware of every server that should share it. */
const createWorkerBudget = (limit = 0): WorkerBudget => {
  const members = new Set<WorkerBudgetMember>();
  const getWorkerCount = () => Array.from(members).reduce((result, member) => result + member.getWorkerCount(), 0);

  return {
    limit,
    join: (member) => {
      members.add(member);
    },
    leave: (member) => {
      members.delete(member);
    },
    hasRoom: () => limit <= 0 || getWorkerCount() < limit,
    findIdleWorker: () => pickIdleWorker(Array.from(members).map((member) => member.findIdleWorker())),
    wakeUp: (except) => members.forEach((member) => member !== except && member.wakeUp()),
    getStats: () => ({ limit, workers: getWorkerCount() }),
  };
};

export default createWorkerBudget;
