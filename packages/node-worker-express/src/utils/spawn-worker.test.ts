import net from 'net';
import path from 'path';
import { WORKER_EVENT } from '../constants';
import spawnWorker from './spawn-worker';
import { encodeMessage } from './frames';
import type { WorkerOutputEvent } from '../types';

jest.mock('@koeroesi86/node-worker', () => {
  const { EventEmitter } = require('events');
  const { Duplex } = require('stream');

  class FakeWorker {
    static instances: FakeWorker[] = [];
    static noChannel = false;
    readonly socket = new Duplex({ read() {}, write: (_chunk: Buffer, _encoding: string, callback: () => void) => callback() });
    readonly instance = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdio: [null, null, null, FakeWorker.noChannel ? null : this.socket] as unknown[],
    });
    readonly terminate = jest.fn();

    constructor(
      readonly command: string,
      readonly options: { cwd?: string }
    ) {
      FakeWorker.instances.push(this);
    }
  }

  return { __esModule: true, default: FakeWorker };
});

const FakeWorker = jest.requireMock('@koeroesi86/node-worker').default;

describe('spawnWorker', () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
    FakeWorker.noChannel = false;
  });

  it('starts node with the worker invoker and the path of the worker', () => {
    spawnWorker({ workerPath: '/root/a.js', options: {}, onHandBack: jest.fn(), onMessage: jest.fn() });

    expect(FakeWorker.instances[0].command).toBe(`node --expose-gc ${path.resolve(__dirname, '../workerInvoke.js')} /root/a.js`);
  });

  it('gives the worker the stdio layout with the socket pair and the IPC channel, over the given options', () => {
    spawnWorker({ workerPath: '/root/a.js', options: { cwd: '/root', stdio: 'inherit' }, onHandBack: jest.fn(), onMessage: jest.fn() });

    expect(FakeWorker.instances[0].options).toEqual({ cwd: '/root', stdio: ['pipe', 'pipe', 'pipe', 'overlapped', 'ipc'] });
  });

  it('builds the options only when they are a function, at spawn', () => {
    const options = jest.fn(() => ({ cwd: '/made' }));

    spawnWorker({ workerPath: '/root/a.js', options, onHandBack: jest.fn(), onMessage: jest.fn() });

    expect([options.mock.calls.length, FakeWorker.instances[0].options.cwd]).toEqual([1, '/made']);
  });

  it('hands the messages of the worker to onMessage', async () => {
    const message = { requestId: 'r' } as never as WorkerOutputEvent;
    const received = new Promise<WorkerOutputEvent>((resolve) =>
      spawnWorker({ workerPath: '/root/a.js', options: {}, onHandBack: jest.fn(), onMessage: resolve })
    );

    FakeWorker.instances[0].socket.push(Buffer.concat(encodeMessage(message)));

    await expect(received).resolves.toEqual(message);
  });

  it('writes to the socket of the worker through the channel it returns', () => {
    const { channel } = spawnWorker({ workerPath: '/root/a.js', options: {}, onHandBack: jest.fn(), onMessage: jest.fn() });
    const write = jest.spyOn(FakeWorker.instances[0].socket, 'write');

    const sent = channel.send({ requestId: 'r' } as never);

    expect([sent, write.mock.calls.length > 0]).toEqual([true, true]);
  });

  it('attaches the output listeners to stdout and stderr', () => {
    const onStdout = jest.fn();
    const onStderr = jest.fn();
    spawnWorker({ workerPath: '/root/a.js', options: {}, onHandBack: jest.fn(), onMessage: jest.fn(), onStdout, onStderr });
    const { stdout, stderr } = FakeWorker.instances[0].instance;

    stdout.emit('data', Buffer.from('out'));
    stderr.emit('data', Buffer.from('err'));

    expect([onStdout.mock.calls, onStderr.mock.calls]).toEqual([[[Buffer.from('out')]], [[Buffer.from('err')]]]);
  });

  it('attaches no output listener when none is given', () => {
    spawnWorker({ workerPath: '/root/a.js', options: {}, onHandBack: jest.fn(), onMessage: jest.fn() });
    const { stdout, stderr } = FakeWorker.instances[0].instance;

    expect([stdout.listenerCount('data'), stderr.listenerCount('data')]).toEqual([0, 0]);
  });

  describe('the connection of a handed over request that comes back', () => {
    const handBack = { type: WORKER_EVENT.REQUEST_HANDBACK, requestId: 'r', event: { statusCode: 200 }, leftover: '' };

    it('hands it to onHandBack with its message', () => {
      const onHandBack = jest.fn();
      spawnWorker({ workerPath: '/root/a.js', options: {}, onHandBack, onMessage: jest.fn() });
      const socket = new net.Socket();

      FakeWorker.instances[0].instance.emit('message', handBack, socket);

      expect(onHandBack).toHaveBeenCalledWith(handBack, socket);
    });

    it.each([
      ['a message that is not a hand back', { ...handBack, type: WORKER_EVENT.REQUEST_HANDOFF_DONE }],
      ['a message that does not say which request it is for', { ...handBack, requestId: undefined }],
    ])('closes a connection that came with %s', (_name, message) => {
      const onHandBack = jest.fn();
      spawnWorker({ workerPath: '/root/a.js', options: {}, onHandBack, onMessage: jest.fn() });
      const socket = new net.Socket();

      FakeWorker.instances[0].instance.emit('message', message, socket);

      expect(onHandBack).not.toHaveBeenCalled();
      expect(socket.destroyed).toBe(true);
    });

    it('ignores a message without a connection', () => {
      const onHandBack = jest.fn();
      spawnWorker({ workerPath: '/root/a.js', options: {}, onHandBack, onMessage: jest.fn() });

      FakeWorker.instances[0].instance.emit('message', handBack, undefined);

      expect(onHandBack).not.toHaveBeenCalled();
    });
  });

  it('terminates the worker and throws when it has no channel', () => {
    FakeWorker.noChannel = true;

    expect(() => spawnWorker({ workerPath: '/root/a.js', options: {}, onHandBack: jest.fn(), onMessage: jest.fn() })).toThrow(
      'The worker /root/a.js has no channel.'
    );
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
  });
});
