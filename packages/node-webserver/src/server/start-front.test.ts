import { EventEmitter } from 'events';
import startFront from './start-front';
import createServer from './create-server';
import { createMergedSignals, fingerprintConfiguration, readServerVersion } from '../cluster';
import createMockLogger from '../observability/mock-logger.test-helper';

jest.mock('./create-server', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../cluster', () => ({ ...jest.requireActual('../cluster'), createMergedSignals: jest.fn() }));

describe('startFront', () => {
  const logger = createMockLogger();
  const signals = { on: jest.fn(), once: jest.fn(), off: jest.fn(), detach: jest.fn(), receive: jest.fn() };
  const prepared = { instances: [], commit: jest.fn(), discard: jest.fn() };
  const report = { files: ['a.js'], fingerprint: 'running', targets: [], certificates: [] };
  const running = { stop: jest.fn(async () => undefined), removeProcessHooks: jest.fn(), prepare: jest.fn(() => prepared), report: () => report };
  const configuration = { portHttp: 80 };
  const release = { configuration: fingerprintConfiguration(configuration), version: readServerVersion() };
  const originalSend = process.send;
  let channel: EventEmitter;
  /** kept here, so that the process of the tests gets none */
  let exitListeners: Array<() => void>;
  let send: jest.Mock;
  let exit: jest.SpyInstance;
  // a test process can have a channel of its own, to the one that runs the tests
  const original = Object.getOwnPropertyDescriptor(process, 'channel');
  const ref = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    channel = new EventEmitter();
    exitListeners = [];
    send = jest.fn((message: { nodeWebserver: string }, _handle, _options, callback: () => void) => {
      callback();
      // as the primary answers
      if (message.nodeWebserver === 'hello') process.nextTick(() => channel.emit('message', { nodeWebserver: 'targets', changes: [] }));
    });
    process.send = send;
    const on = process.on.bind(process);
    jest.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (event === 'message') return channel.on(event, listener) && process;
      if (event !== 'exit') return on(event, listener);
      exitListeners.push(listener as () => void);
      return process;
    });
    exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    jest.mocked(createMergedSignals).mockReturnValue(signals);
    jest.mocked(createServer).mockResolvedValue(running as never);
    Object.defineProperty(process, 'channel', { configurable: true, writable: true, value: { ref } });
  });

  afterEach(() => {
    if (original) Object.defineProperty(process, 'channel', original);
    else Reflect.deleteProperty(process, 'channel');
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
      sharedTargets: expect.any(Object),
      acmeChallenges: expect.any(Map),
      sharedApps: expect.any(Object),
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

  it('has the channel to the primary keep it running from the start of the server', async () => {
    await startFront({ index: 0, count: 2 }, configuration, logger, {});

    expect(ref.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(createServer).mock.invocationCallOrder[0]);
  });

  it('starts its servers with the registered targets, once the primary told them, and hears of changes', async () => {
    send.mockImplementation((_message, _handle, _options, callback: () => void) => callback());
    const change = { key: 'https a', target: 'http://203.0.113.7/', setAt: 1 };
    const started = startFront({ index: 0, count: 2 }, configuration, logger, {});

    await new Promise(process.nextTick);
    expect(createServer).not.toHaveBeenCalled();
    channel.emit('message', { nodeWebserver: 'targets', changes: [change] });
    await started;
    const targets = jest.mocked(createServer).mock.calls[0][2]?.sharedTargets;
    expect(targets?.get('https a')).toEqual(change);

    void targets?.publish({ ...change, setAt: 2 });
    expect(sent()).toContainEqual({ nodeWebserver: 'target', change: { ...change, setAt: 2 } });
  });

  it('answers the challenges the primary tells it, and says that it has them', async () => {
    await startFront({ index: 0, count: 2 }, configuration, logger, {});
    const challenges = jest.mocked(createServer).mock.calls[0][2]?.acmeChallenges;

    channel.emit('message', { nodeWebserver: 'challenge', token: 'a', answer: 'b' });
    expect(challenges?.get('a')).toBe('b');
    channel.emit('message', { nodeWebserver: 'challenge', token: 'a' });

    expect(challenges?.size).toBe(0);
    expect(sent().slice(2)).toEqual([{ nodeWebserver: 'challenge-taken', token: 'a' }]);
  });

  it('hears from the primary the port of an application it claimed', async () => {
    await startFront({ index: 0, count: 2 }, configuration, logger, {});
    const apps = jest.mocked(createServer).mock.calls[0][2]?.sharedApps;
    const port = apps?.claim('a', {});

    channel.emit('message', { nodeWebserver: 'app-port', key: 'a', port: 4000 });

    await expect(port).resolves.toBe(4000);
    expect(sent()).toContainEqual({ nodeWebserver: 'app-claim', key: 'a', port: undefined, lookup: undefined });
  });

  it.each([
    [false, 1],
    [true, 0],
  ])('ends the applications when it ends and the primary is gone (connected: %s)', async (connected, kills) => {
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const original = Object.getOwnPropertyDescriptor(process, 'connected');
    Object.defineProperty(process, 'connected', { configurable: true, value: connected });
    await startFront({ index: 0, count: 2 }, configuration, logger, {});
    channel.emit('message', { nodeWebserver: 'apps', running: [{ key: 'a', pid: 4321 }] });

    exitListeners.forEach((listener) => listener());

    expect(kill).toHaveBeenCalledTimes(kills);
    if (original) Object.defineProperty(process, 'connected', original);
    else Reflect.deleteProperty(process, 'connected');
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

    expect(createMergedSignals).not.toHaveBeenCalled();
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
    expect(logger.system).toHaveBeenCalledWith(expect.stringContaining('the primary looks at the change'));
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
