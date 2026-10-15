import invokeWorker from './invoke-worker';

const event = {} as Parameters<typeof invokeWorker>[1];
const callback = jest.fn();

describe('invokeWorker', () => {
  it('calls the worker with the event and the callback, and reports when it is done', async () => {
    const worker = jest.fn().mockResolvedValue(undefined);
    const onError = jest.fn();
    const settled = new Promise<void>((resolve) => invokeWorker(worker, event, callback, onError, resolve));

    await settled;

    expect(worker).toHaveBeenCalledWith(event, callback);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a rejected promise and then settles', async () => {
    const error = new Error('async');
    const onError = jest.fn();

    await new Promise<void>((resolve) => invokeWorker(() => Promise.reject(error), event, callback, onError, resolve));

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('reports a synchronous throw and settles instead of crashing', () => {
    const error = new Error('sync');
    const onError = jest.fn();
    const onSettled = jest.fn();

    invokeWorker(
      () => {
        throw error;
      },
      event,
      callback,
      onError,
      onSettled
    );

    expect(onError).toHaveBeenCalledWith(error);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
