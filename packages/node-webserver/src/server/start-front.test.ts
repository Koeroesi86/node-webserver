import { EventEmitter } from 'events';
import startFront from './start-front';
import createServer from './create-server';
import { createFrontSignals, fingerprintConfiguration, readServerVersion } from '../cluster';
import createMockLogger from '../observability/mock-logger.test-helper';

jest.mock('./create-server', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../cluster', () => ({ ...jest.requireActual('../cluster'), createFrontSignals: jest.fn() }));

describe('startFront', () => {
  const logger = createMockLogger();
  const signals = { on: jest.fn(), once: jest.fn(), off: jest.fn(), detach: jest.fn(), receive: jest.fn() };
  const prepared = { instances: [], commit: jest.fn(), discard: jest.fn() };
  const report = { files: ['a.js'], fingerprint: 'running' };
  const running = { stop: jest.fn(async () => undefined), removeProcessHooks: jest.fn(), prepare: jest.fn(() => prepared), report: () => report };
  const configuration = { portHttp: 80 };
  const release = { configuration: fingerprintConfiguration(configuration), version: readServerVersion() };
  const originalSend = process.send;
  let channel: EventEmitter;
  let send: jest.Mock;
  let exit: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    channel = new EventEmitter();
    send = jest.fn((_message, _handle, _options, callback: () => void) => callback());
    process.send = send;
    const on = process.on.bind(process);
    jest.spyOn(process, 'on').mockImplementation((event, listener) => (event === 'message' ? channel.on(event, listener) && process : on(event, listener)));
    exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    jest.mocked(createFrontSignals).mockReturnValue(signals);
    jest.mocked(createServer).mockResolvedValue(running as never);
  });

  afterEach(() => {
    process.send = originalSend;
    jest.restoreAllMocks();
  });

  const sent = () => send.mock.calls.map(([message]) => message);

  it('serves with its share and the signals of both sides, and tells the primary once it does', async () => {
    const front = await startFront({ index: 1, count: 2 }, configuration, logger, {});

    expect(createServer).toHaveBeenCalledWith(configuration, logger, {
      processHooks: true,
      front: { index: 1, count: 2 },
      signals,
      stoppable: true,
      requestReload: expect.any(Function),
    });
    expect(sent()).toEqual([{ nodeWebserver: 'hello' }, { nodeWebserver: 'ready', release, ...report }]);
    expect(front).toMatchObject({ role: 'front', frontCount: 2 });
  });

  it('asks the primary to load the servers of all fronts, whether the program or the server asks for it', async () => {
    const front = await startFront({ index: 0, count: 2 }, configuration, logger, {});

    front.reload();
    jest.mocked(createServer).mock.calls[0][2]?.requestReload?.();

    expect(sent().slice(2)).toEqual([{ nodeWebserver: 'reload-request' }, { nodeWebserver: 'reload-request' }]);
  });

  it('does what the primary tells it', async () => {
    await startFront({ index: 0, count: 2 }, configuration, logger, {});

    channel.emit('message', { nodeWebserver: 'prepare', round: 1 });
    channel.emit('message', { nodeWebserver: 'commit', round: 1 });
    channel.emit('message', { nodeWebserver: 'prepare', round: 2 });
    channel.emit('message', { nodeWebserver: 'discard', round: 2 });
    channel.emit('message', { nodeWebserver: 'signal', signal: 'SIGTERM' });
    channel.emit('message', 'reload');
    channel.emit('message', { nodeWebserver: 'stop' });
    await new Promise(process.nextTick);

    expect(running.prepare).toHaveBeenCalledTimes(2);
    expect(prepared.commit).toHaveBeenCalledTimes(1);
    expect(prepared.discard).toHaveBeenCalledTimes(1);
    expect(signals.receive).toHaveBeenCalledWith('SIGTERM');
    expect(running.stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('leaves the signals to the caller without process hooks, and still stops when told to', async () => {
    await startFront({ index: 0, count: 2 }, configuration, logger, { processHooks: false });

    channel.emit('message', { nodeWebserver: 'signal', signal: 'SIGTERM' });
    channel.emit('message', { nodeWebserver: 'stop' });
    await new Promise(process.nextTick);

    expect(createFrontSignals).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('ends at once when it is told to stop while it starts', async () => {
    jest.mocked(createServer).mockImplementation(async () => {
      channel.emit('message', { nodeWebserver: 'stop' });
      await new Promise(process.nextTick);
      return running as never;
    });

    await startFront({ index: 0, count: 2 }, configuration, logger, {});

    expect(exit).toHaveBeenCalledWith(0);
    expect(running.stop).not.toHaveBeenCalled();
  });

  it('takes the place of a front when it finds what that one ran', async () => {
    await startFront({ index: 0, count: 2, expected: release }, configuration, logger, {});

    expect(createServer).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('ends without serving when it replaces a front and finds another release', async () => {
    exit.mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(startFront({ index: 0, count: 2, expected: { ...release, version: '0.0.0' } }, configuration, logger, {})).rejects.toThrow('exit');

    expect(createServer).not.toHaveBeenCalled();
    expect(sent()).toContainEqual({ nodeWebserver: 'stale', reason: expect.stringContaining('version') });
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('restart the server'));
  });

  it('tells the primary why it does not start, and ends with an error', async () => {
    jest.mocked(createServer).mockRejectedValue(new Error('no such file'));
    exit.mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(startFront({ index: 0, count: 2 }, configuration, logger, {})).rejects.toThrow('exit');

    expect(sent()).toContainEqual({ nodeWebserver: 'failed', reason: 'no such file' });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('ends the same way when a port cannot be listened on, which nothing catches', async () => {
    const before = process.listeners('uncaughtException');
    jest.mocked(createServer).mockImplementation(() => {
      const [added] = process.listeners('uncaughtException').filter((listener) => !before.includes(listener));
      added(new Error('EADDRINUSE'), 'uncaughtException');
      return new Promise(() => {});
    });

    void startFront({ index: 0, count: 2 }, configuration, logger, {});
    await new Promise(setImmediate);
    process
      .listeners('uncaughtException')
      .filter((listener) => !before.includes(listener))
      .forEach((listener) => process.off('uncaughtException', listener));

    expect(sent()).toContainEqual({ nodeWebserver: 'failed', reason: 'EADDRINUSE' });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
