import type { InvokableWorker } from '../types';

/** runs the worker, a synchronous throw and a rejected promise end up in the same error handler instead of crashing the process */
export default function invokeWorker(
  worker: InvokableWorker,
  event: Parameters<InvokableWorker>[0],
  callback: Parameters<InvokableWorker>[1],
  onError: (error: unknown) => void,
  onSettled = () => {}
) {
  try {
    Promise.resolve(worker(event, callback)).catch(onError).finally(onSettled);
  } catch (error) {
    onError(error);
    onSettled();
  }
}
