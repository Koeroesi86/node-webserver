import addExitListeners from './exitHandler';
import logger from './logger';

jest.mock('./logger', () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn(), system: jest.fn(), flush: jest.fn() } }));
jest.mock('fs', () => ({ existsSync: jest.fn(() => false), readdirSync: jest.fn(() => []) }));

describe('addExitListeners', () => {
  let listeners: Record<string, (event: unknown) => void>;
  let kill: jest.SpyInstance;

  beforeEach(() => {
    listeners = {};
    jest.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
    jest.spyOn(process, 'once').mockImplementation((event, listener) => {
      listeners[String(event)] = listener;
      return process;
    });
    jest.spyOn(process, 'off').mockImplementation(() => process);
    kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.mocked(logger.flush).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes the log before the signal is raised again, as a process ended by a signal does not run its exit handlers', () => {
    const order: string[] = [];
    jest.mocked(logger.flush).mockImplementation(() => order.push('flush'));
    kill.mockImplementation(() => order.push('kill') > 0);
    addExitListeners(() => []);

    listeners.SIGTERM('SIGTERM');

    expect(order).toEqual(['flush', 'kill']);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('stops the children of the servers', () => {
    const child = { kill: jest.fn() };
    addExitListeners((() => [{ hostname: 'a', protocol: 'http', child }]) as unknown as Parameters<typeof addExitListeners>[0]);

    listeners.SIGINT('SIGINT');

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('does not raise a signal when the process is exiting anyway', () => {
    addExitListeners(() => []);

    listeners.exit(0);

    expect(logger.flush).toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it('raises SIGINT after an uncaught exception', () => {
    addExitListeners(() => []);

    listeners.uncaughtException(new Error('boom'));

    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
  });

  it('stops on SIGHUP by default', () => {
    addExitListeners(() => []);

    expect(listeners.SIGHUP).toBeDefined();
  });

  it('leaves SIGHUP alone when the server loads the configuration again on it', () => {
    addExitListeners(() => [], { exitOnHangUp: false });

    expect(listeners.SIGHUP).toBeUndefined();
  });

  it('stops the children of the servers there are when the process stops, not of the ones there were at the start', () => {
    const before = { kill: jest.fn() };
    const after = { kill: jest.fn() };
    let children = [before];
    addExitListeners((() => children.map((child) => ({ hostname: 'a', protocol: 'http', child }))) as unknown as Parameters<typeof addExitListeners>[0]);
    children = [after];

    listeners.SIGTERM('SIGTERM');

    expect(before.kill).not.toHaveBeenCalled();
    expect(after.kill).toHaveBeenCalledWith('SIGTERM');
  });

  describe('with a graceful stop', () => {
    const stoppingAt = (...events: string[]) => {
      let finish = () => {};
      const gracefulStop = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
            events.push('started');
          })
      );
      return { gracefulStop, finish: () => finish() };
    };

    it.each(['SIGINT', 'SIGTERM', 'SIGHUP'])('waits for the stop on %s before the signal is raised again', async (signal) => {
      const { gracefulStop, finish } = stoppingAt();
      addExitListeners(() => [], { gracefulStop });

      const stopped = listeners[signal](signal);
      expect(gracefulStop).toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
      finish();
      await stopped;

      expect(kill).toHaveBeenCalledWith(process.pid, signal);
    });

    it('ends at once on a second signal while it waits', async () => {
      const { gracefulStop } = stoppingAt();
      const child = { kill: jest.fn() };
      addExitListeners((() => [{ hostname: 'a', protocol: 'http', child }]) as unknown as Parameters<typeof addExitListeners>[0], { gracefulStop });

      void listeners.SIGTERM('SIGTERM');
      listeners.SIGTERM('SIGTERM');

      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('stops listening for a second signal once it raises the signal itself, so that the process ends', async () => {
      const { gracefulStop, finish } = stoppingAt();
      const off = jest.mocked(process.off);
      addExitListeners(() => [], { gracefulStop });

      const stopped = listeners.SIGTERM('SIGTERM');
      finish();
      await stopped;

      expect(off.mock.calls.map(([signal]) => signal)).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM', 'SIGHUP']));
      expect(off.mock.invocationCallOrder[0]).toBeLessThan(kill.mock.invocationCallOrder[0]);
    });

    it('still stops the children and raises the signal when the stop fails', async () => {
      const child = { kill: jest.fn() };
      addExitListeners((() => [{ hostname: 'a', protocol: 'http', child }]) as unknown as Parameters<typeof addExitListeners>[0], {
        gracefulStop: () => Promise.reject(new Error('broken')),
      });

      await listeners.SIGTERM('SIGTERM');

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });

    it.each(['SIGUSR1', 'SIGUSR2', 'uncaughtException'])('ends at once on %s, as the state may be broken', (reason) => {
      const { gracefulStop } = stoppingAt();
      addExitListeners(() => [], { gracefulStop });

      listeners[reason](new Error('boom'));

      expect(gracefulStop).not.toHaveBeenCalled();
      expect(kill).toHaveBeenCalled();
    });

    it('leaves SIGHUP to the reload', () => {
      addExitListeners(() => [], { exitOnHangUp: false, gracefulStop: jest.fn() });

      expect(listeners.SIGHUP).toBeUndefined();
    });
  });
});
