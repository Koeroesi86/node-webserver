import addExitListeners from './exitHandler';
import createGracefulStop from './create-graceful-stop';
import setupShutdown from './setup-shutdown';
import createMockLogger from './mock-logger.test-helper';

jest.mock('./exitHandler', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./create-graceful-stop', () => ({ __esModule: true, default: jest.fn() }));

describe('setupShutdown', () => {
  const stop = jest.fn(async () => undefined);
  const options = { logger: createMockLogger(), shutdownTimeout: 7, reload: jest.fn(), getLoaded: () => [], getInstances: () => [] };

  beforeEach(() => {
    jest.mocked(addExitListeners).mockClear();
    jest.mocked(createGracefulStop).mockClear();
    jest.mocked(createGracefulStop).mockReturnValue(stop);
    stop.mockClear();
  });

  it('stops softly with the shutdown timeout and ends the process on SIGHUP', async () => {
    setupShutdown([], { ...options, reloadOnSighup: false });
    const { exitOnHangUp, gracefulStop } = jest.mocked(addExitListeners).mock.calls[0][2] ?? {};

    await gracefulStop?.();

    expect(exitOnHangUp).toBe(true);
    expect(stop).toHaveBeenCalledWith(7);
  });

  it('closes every loaded instance with the time that is left', async () => {
    const close = jest.fn(async () => undefined);
    setupShutdown([], { ...options, getLoaded: () => [{ close }, { close }] as never, reloadOnSighup: false });
    const stopBehind = jest.mocked(createGracefulStop).mock.calls[0][1];

    await stopBehind(3);

    expect(close).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledWith(3);
  });

  it('leaves SIGHUP to the reload when it is asked to', () => {
    const before = process.listenerCount('SIGHUP');

    setupShutdown([], { ...options, reloadOnSighup: true });

    expect(jest.mocked(addExitListeners).mock.calls[0][2]?.exitOnHangUp).toBe(false);
    expect(process.listenerCount('SIGHUP')).toBe(before + 1);
    process.off('SIGHUP', options.reload);
  });
});
