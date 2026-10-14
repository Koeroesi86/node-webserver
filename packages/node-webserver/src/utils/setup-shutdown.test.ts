import addExitListeners from './exitHandler';
import createGracefulStop from './create-graceful-stop';
import setupShutdown from './setup-shutdown';

jest.mock('./exitHandler', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./create-graceful-stop', () => ({ __esModule: true, default: jest.fn() }));

describe('setupShutdown', () => {
  const stop = jest.fn(async () => undefined);
  const options = { shutdownTimeout: 7, reload: jest.fn(), getLoaded: () => [], getInstances: () => [] };

  beforeEach(() => {
    jest.mocked(addExitListeners).mockClear();
    jest.mocked(createGracefulStop).mockReturnValue(stop);
    stop.mockClear();
  });

  it('stops softly with the shutdown timeout and ends the process on SIGHUP', async () => {
    setupShutdown([], { ...options, reloadOnSighup: false });
    const { exitOnHangUp, gracefulStop } = jest.mocked(addExitListeners).mock.calls[0][1] ?? {};

    await gracefulStop?.();

    expect(exitOnHangUp).toBe(true);
    expect(stop).toHaveBeenCalledWith(7);
  });

  it('leaves SIGHUP to the reload when it is asked to', () => {
    const before = process.listenerCount('SIGHUP');

    setupShutdown([], { ...options, reloadOnSighup: true });

    expect(jest.mocked(addExitListeners).mock.calls[0][1]?.exitOnHangUp).toBe(false);
    expect(process.listenerCount('SIGHUP')).toBe(before + 1);
    process.off('SIGHUP', options.reload);
  });
});
