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
  afterEach(() => {
    delete process.env[FRONT_PROCESS_ENV];
    jest.resetModules();
  });

  it('is what the primary told the front, which nothing started by the front is told', () => {
    process.env[FRONT_PROCESS_ENV] = JSON.stringify({ index: 1, count: 2 });

    expect(load(true)).toEqual({ index: 1, count: 2 });
    expect(process.env[FRONT_PROCESS_ENV]).toBeUndefined();
  });

  it('is nothing in a process that is not a worker of a cluster', () => {
    process.env[FRONT_PROCESS_ENV] = JSON.stringify({ index: 1, count: 2 });

    expect(load(false)).toBeUndefined();
  });

  it('is nothing in a worker of a cluster of someone else', () => {
    expect(load(true)).toBeUndefined();
  });
});
