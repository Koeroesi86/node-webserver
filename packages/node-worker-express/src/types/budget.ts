/** an idle worker that a pool can stop to make room for another one */
export interface IdleWorker {
  /** the path has other workers, so stopping this one leaves the path with one */
  spare: boolean;
  /** when the worker finished its last request, or started when it had none, as `Date.now()` */
  lastUsed: number;
  stop: () => void;
}

/** a pool of workers as a budget sees it */
export interface WorkerBudgetMember {
  getWorkerCount: () => number;
  /** the idle worker the pool gives up first, undefined when all of its workers are busy */
  findIdleWorker: () => IdleWorker | undefined;
  /** the requests that wait for a worker in the pool look again whether they can get one */
  wakeUp: () => void;
  /** stops all of its workers, for a process that ends */
  onClose: () => void;
}

/** A limit on the workers of several pools together, so that the processes of many servers and paths stay bounded. Made by `createWorkerBudget`. */
export interface WorkerBudget {
  /** how many workers the pools may run together, 0 for no limit */
  readonly limit: number;
  join: (member: WorkerBudgetMember) => void;
  /** a pool that is disposed of stops counting */
  leave: (member: WorkerBudgetMember) => void;
  hasRoom: () => boolean;
  /** the idle worker of all the pools that is given up first */
  findIdleWorker: () => IdleWorker | undefined;
  /** a worker stopped or became idle, the requests that wait in the other pools may get one now */
  wakeUp: (except?: WorkerBudgetMember) => void;
  getStats: () => { limit: number; workers: number };
  /** stops the workers of all the pools, which a process that ends has to do as nothing else stops them */
  close: () => void;
}
