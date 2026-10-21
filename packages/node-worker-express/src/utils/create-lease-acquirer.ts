import type { WorkerPool } from '@koeroesi86/node-worker/pool';
import type { Response } from 'express';

type Acquire = WorkerPool['acquire'];

interface LeaseAcquirerParams {
  acquire: Acquire;
  staticWorker: string;
  workerOptions: Parameters<Acquire>[1];
  staticWorkerOptions: Parameters<Acquire>[1];
  getLimitPerPath: (indexPath: string) => number;
}

/** Gets a worker for a request: the one of its path, or the static worker. The request leaves the line when its client goes away. */
const createLeaseAcquirer = ({ acquire, staticWorker, workerOptions, staticWorkerOptions, getLimitPerPath }: LeaseAcquirerParams) => {
  return (response: Response, indexPath: string, isWorker: boolean) => {
    const [workerPath, options] = isWorker ? [indexPath, workerOptions] : [staticWorker, staticWorkerOptions];
    const abandoned = new AbortController();
    const abandon = () => abandoned.abort();
    response.once('close', abandon);

    return acquire(workerPath, options, getLimitPerPath(indexPath), abandoned.signal).finally(() => response.off('close', abandon));
  };
};

export default createLeaseAcquirer;
