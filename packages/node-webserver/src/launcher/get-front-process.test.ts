import { FRONT_PROCESS_ENV } from '../constants';

const load = (isWorker: boolean) => {
  let front: unknown;
  jest.isolateModules(() => {
    jest.doMock('cluster', () => ({ __esModule: true, default: { isWorker } }));
    front = require('./get-front-process').default();
  });
  return front;
};

describe('getFrontProcess', () => {
  // a test process can have a channel of its own, to the one that runs the tests
  const original = Object.getOwnPropertyDescriptor(process, 'channel');
  const unref = jest.fn();

  beforeEach(() => {
    unref.mockClear();
    Object.defineProperty(process, 'channel', { configurable: true, writable: true, value: { unref } });
  });

  afterEach(() => {
    if (original) Object.defineProperty(process, 'channel', original);
    else Reflect.deleteProperty(process, 'channel');
    delete process.env[FRONT_PROCESS_ENV];
    jest.resetModules();
  });

  it('is what the primary told the front, which nothing started by the front is told', () => {
    process.env[FRONT_PROCESS_ENV] = JSON.stringify({ index: 1, count: 2 });

    expect(load(true)).toEqual({ index: 1, count: 2 });
    expect(process.env[FRONT_PROCESS_ENV]).toBeUndefined();
  });

  it('lets a front end whose script fails, which its channel would keep running', () => {
    process.env[FRONT_PROCESS_ENV] = JSON.stringify({ index: 1, count: 2 });
    load(true);

    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('is nothing in a process that is not a worker of a cluster', () => {
    process.env[FRONT_PROCESS_ENV] = JSON.stringify({ index: 1, count: 2 });

    expect(load(false)).toBeUndefined();
  });

  it('is nothing in a worker of a cluster of someone else', () => {
    expect(load(true)).toBeUndefined();
  });
});
