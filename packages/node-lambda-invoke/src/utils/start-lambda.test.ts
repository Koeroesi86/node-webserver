import { EventEmitter } from 'events';
import startLambda from './start-lambda';
import type { StartLambdaOptions } from './start-lambda';

const mockWorker = new EventEmitter();

jest.mock('./spawn-lambda-process', () => ({
  __esModule: true,
  default: () => {
    const emitter: EventEmitter = mockWorker;
    return {
      storageFolder: '/storage',
      worker: {
        instance: {},
        stdout: undefined,
        stderr: undefined,
        terminate: jest.fn(),
        addEventListener: (event: string, listener: () => void) => emitter.on(event, listener),
        addEventListenerOnce: (event: string, listener: () => void) => emitter.once(event, listener),
        removeEventListener: (event: string, listener: () => void) => emitter.off(event, listener),
      },
    };
  },
}));

const options = (overrides: Partial<StartLambdaOptions> = {}): StartLambdaOptions => ({
  id: 'abc',
  lambdaPath: '/lambdas/a.js',
  handlerKey: 'handler',
  communication: { type: 'ipc' },
  maxLifetime: 1000,
  restrictFileSystem: true,
  logger: jest.fn(),
  startTimeout: 1000,
  ...overrides,
});

describe('startLambda', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockWorker.removeAllListeners();
  });
  afterEach(() => jest.useRealTimers());

  it('settles with the lambda once the process announced itself, and logs it', async () => {
    const logger = jest.fn();
    const started = startLambda(options({ logger }));

    mockWorker.emit('message', { type: 'LAMBDA_EVENT_STARTED' });
    const lambda = await started;

    expect(lambda).toMatchObject({ storageFolder: '/storage', busy: false, retiring: false });
    expect(logger).toHaveBeenCalledWith('[abc] started');
    // the timer is gone, so the lambda is not killed afterwards
    jest.advanceTimersByTime(10000);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('fails when the process exits before it announced itself', async () => {
    const started = startLambda(options());

    mockWorker.emit('close', 1);

    await expect(started).rejects.toThrow('Lambda /lambdas/a.js did not start: it exited with code 1');
  });

  it('fails when the process errors', async () => {
    const started = startLambda(options());

    mockWorker.emit('error', 'spawn failed');

    await expect(started).rejects.toThrow('did not start: spawn failed');
  });

  it('fails and kills a process that takes longer than the start timeout', async () => {
    const started = startLambda(options({ startTimeout: 500 }));
    const settled = expect(started).rejects.toThrow('it took longer than 500ms');

    jest.advanceTimersByTime(500);

    await settled;
  });
});
