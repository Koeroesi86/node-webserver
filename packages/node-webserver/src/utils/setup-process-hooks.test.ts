import setupShutdown from './setup-shutdown';
import setupProcessHooks from './setup-process-hooks';
import createMockLogger from './mock-logger.test-helper';

jest.mock('./setup-shutdown', () => ({ __esModule: true, default: jest.fn() }));

describe('setupProcessHooks', () => {
  const shutdown = { logger: createMockLogger(), reloadOnSighup: false, shutdownTimeout: 1, reload: jest.fn(), getLoaded: () => [], getInstances: () => [] };

  beforeEach(() => jest.mocked(setupShutdown).mockReset());

  it('adds the exit listener of the budget and takes it off together with the shutdown', () => {
    const removeShutdown = jest.fn();
    jest.mocked(setupShutdown).mockReturnValue(removeShutdown);
    const before = process.listenerCount('exit');

    const hooks = setupProcessHooks(true, [], { close: jest.fn() }, shutdown);
    const during = process.listenerCount('exit');
    hooks.remove();

    expect(during).toBe(before + 1);
    expect(process.listenerCount('exit')).toBe(before);
    expect(removeShutdown).toHaveBeenCalledTimes(1);
  });

  it('adds the listener of the budget before the shutdown adds its own, which flushes the logger', () => {
    const close = jest.fn();
    let budgetWasThere = false;
    jest.mocked(setupShutdown).mockImplementation(() => {
      budgetWasThere = process.listeners('exit').includes(close);
      return jest.fn();
    });

    setupProcessHooks(true, [], { close }, shutdown).remove();

    expect(budgetWasThere).toBe(true);
  });

  it('takes only the listener of the budget off for a server that closed', () => {
    const removeShutdown = jest.fn();
    jest.mocked(setupShutdown).mockReturnValue(removeShutdown);
    const before = process.listenerCount('exit');

    const hooks = setupProcessHooks(true, [], { close: jest.fn() }, shutdown);
    hooks.removeWorkerBudget();

    expect(process.listenerCount('exit')).toBe(before);
    expect(removeShutdown).not.toHaveBeenCalled();
    hooks.remove();
  });

  it('adds nothing when it is disabled', () => {
    const before = process.listenerCount('exit');

    const hooks = setupProcessHooks(false, [], { close: jest.fn() }, shutdown);
    hooks.remove();

    expect(setupShutdown).not.toHaveBeenCalled();
    expect(process.listenerCount('exit')).toBe(before);
  });
});
