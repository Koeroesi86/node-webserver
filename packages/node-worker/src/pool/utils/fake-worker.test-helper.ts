/** the module of `Worker` for `jest.mock('../../index', () => createFakeWorkerModule())`: workers that are not processes, and the real waiting line */
export const createFakeWorkerModule = () => {
  const { EventEmitter } = require('events');
  const { Duplex } = require('stream');
  const { encodeMessage, FrameDecoder } = require('./frames');

  class FakeWorker {
    static instances: FakeWorker[] = [];
    static noChannel = false;
    /** the messages the pool sent to the worker */
    readonly sent: unknown[] = [];
    private readonly decoder = new FrameDecoder((message: unknown) => this.sent.push(message));
    private readonly socket = new Duplex({
      read() {},
      write: (chunk: Buffer, _encoding: string, callback: () => void) => {
        this.decoder.push(chunk);
        callback();
      },
    });
    /** `stdio` as the child process has it, the fourth is the channel */
    readonly instance = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdio: [null, null, null, FakeWorker.noChannel ? null : this.socket] as unknown[],
      /** the IPC channel of node, which carries the connections that are handed over */
      connected: true,
      send: jest.fn((message: unknown, handle: unknown, callback: (error: Error | null) => void) => callback(null)),
    });
    readonly terminate = jest.fn(() => this.exit(0));

    constructor(
      readonly command: string,
      readonly options: unknown
    ) {
      FakeWorker.instances.push(this);
    }

    addEventListener = (event: string, listener: (...args: unknown[]) => unknown) => this.instance.on(event, listener);
    addEventListenerOnce = (event: string, listener: (...args: unknown[]) => unknown) => this.instance.once(event, listener);
    /** a message of the worker arrives on the channel */
    receive = (message: unknown) => this.socket.push(Buffer.concat(encodeMessage(message)));
    exit = (code: number) => {
      this.instance.exitCode = code;
      this.instance.emit('close', code);
    };
  }

  // the waiting line is the real one: the pool is built on it
  return { __esModule: true, default: FakeWorker, WaitingLine: jest.requireActual('../../index').WaitingLine };
};
