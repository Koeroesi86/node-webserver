import { EventEmitter } from 'events';
import connectLauncher from './connect-launcher';
import sendMessage from './send-message';

jest.mock('./send-message', () => ({ __esModule: true, default: jest.fn(async () => undefined) }));

describe('connectLauncher', () => {
  const signals = { on: jest.fn(), once: jest.fn(), off: jest.fn(), detach: jest.fn(), receive: jest.fn() };
  let channel: EventEmitter;
  let exit: jest.SpyInstance;
  // a test process can have a channel of its own, to the one that runs the tests
  const original = Object.getOwnPropertyDescriptor(process, 'channel');
  const unref = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    channel = new EventEmitter();
    jest.spyOn(process, 'on').mockImplementation((event, listener) => {
      channel.on(event, listener);
      return process;
    });
    exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    Object.defineProperty(process, 'channel', { configurable: true, writable: true, value: { unref } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (original) Object.defineProperty(process, 'channel', original);
    else Reflect.deleteProperty(process, 'channel');
  });

  it('says that it listens, and later that the server serves', () => {
    connectLauncher(signals).serving();

    expect(jest.mocked(sendMessage).mock.calls).toEqual([[{ nodeWebserver: 'hello' }], [{ nodeWebserver: 'serving' }]]);
  });

  it('takes the signals the launcher passes on, and nothing else', () => {
    connectLauncher(signals);

    channel.emit('message', { nodeWebserver: 'signal', signal: 'SIGTERM' });
    channel.emit('message', { nodeWebserver: 'stop' });
    channel.emit('message', 'SIGINT');

    expect(signals.receive.mock.calls).toEqual([['SIGTERM']]);
  });

  it('does not keep the process running for the channel alone', () => {
    connectLauncher(signals);

    expect(unref).toHaveBeenCalled();
  });

  it('ends the server when the launcher is gone', () => {
    connectLauncher(signals);

    channel.emit('disconnect');

    expect(exit).toHaveBeenCalledWith(1);
  });
});
