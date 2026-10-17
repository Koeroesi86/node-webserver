import net from 'net';
import { TLSSocket } from 'tls';
import type { Request, Response } from 'express';
import { WORKER_EVENT } from '../constants';
import type { ResponseMessage } from '../types';
import createResponseHandOff from './create-response-hand-off';
import { handedOffResponses } from './is-handed-off';
import type { WorkerLease } from './workerPool';

interface Overrides {
  encrypted?: boolean;
  socket?: net.Socket;
  method?: string;
  httpVersionMajor?: number;
  streamsBody?: boolean;
  headersSent?: boolean;
  minimumLength?: number;
  head?: Partial<ResponseMessage>;
  /** the client wants the connection kept, and the http server that accepted it takes it back */
  keepAlive?: boolean;
  closing?: boolean;
  connectionHeader?: string;
}

const sockets: net.Socket[] = [];

/** a connection that has not been opened, nothing is written to it: `write` only reports that it was done */
const createSocket = (encrypted = false) => {
  const socket = encrypted ? new TLSSocket(new net.Socket()) : new net.Socket();
  Object.assign(socket, {
    write: (_chunk: unknown, callback?: () => void) => {
      callback?.();
      return true;
    },
  });
  jest.spyOn(socket, 'destroy');
  sockets.push(socket);

  return socket;
};

const setup = ({
  encrypted = false,
  socket = createSocket(encrypted),
  method = 'GET',
  httpVersionMajor = 1,
  streamsBody = false,
  headersSent = false,
  minimumLength = 10,
  head = {},
  keepAlive = false,
  closing = false,
  connectionHeader,
}: Overrides = {}) => {
  const headers = new Map<string, string>();
  const httpServer = new net.Server();
  let accepting = !closing;
  Object.defineProperty(httpServer, 'listening', { get: () => accepting });
  Object.assign(socket, { server: httpServer });
  if (connectionHeader) headers.set('connection', connectionHeader);
  const request = { socket, method, httpVersionMajor };
  const response = {
    shouldKeepAlive: keepAlive,
    headersSent,
    setHeader: jest.fn((name: string, value: string) => headers.set(name.toLowerCase(), value)),
    getHeader: jest.fn((name: string) => headers.get(name)),
    hasHeader: jest.fn((name: string) => headers.has(name)),
    writeHead: jest.fn(),
    flushHeaders: jest.fn(),
  };
  const lease = { send: jest.fn(), handOff: jest.fn().mockResolvedValue(undefined) };
  const onHandedOver = jest.fn();
  const onFailed = jest.fn();
  const handOff = createResponseHandOff({
    request: request as unknown as Request,
    response: response as unknown as Response,
    lease: lease as unknown as WorkerLease,
    requestId: 'r1',
    streamsBody,
    minimumLength,
    timeout: 300,
    onHandedOver,
    onFailed,
  });
  const message: ResponseMessage = { statusCode: 200, headers: { 'Content-Length': '100' }, ...head };

  return { handOff, message, response, lease, socket, httpServer, stopAccepting: () => (accepting = false), onHandedOver, onFailed };
};

const refused = { type: WORKER_EVENT.RESPONSE_HANDOFF_REFUSE, requestId: 'r1' };

describe('createResponseHandOff', () => {
  afterEach(() => sockets.splice(0).forEach((socket) => socket.destroy()));

  it('hands the connection over for a response of a plain HTTP/1 connection that is long enough, as the cases below that refuse differ from it by one thing', async () => {
    const { handOff, message, lease, socket, onHandedOver, response } = setup();

    await handOff.start(message);

    expect(lease.handOff).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId: 'r1', timeout: 300, keepAlive: false }, socket);
    expect(lease.send).not.toHaveBeenCalled();
    expect(onHandedOver).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(handOff.isActive()).toBe(true);
  });

  describe('the connection after the body', () => {
    it('is kept for a client that wants it, which the head says', async () => {
      const { handOff, message, lease, socket, response } = setup({ keepAlive: true });

      await handOff.start(message);

      expect(lease.handOff).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId: 'r1', timeout: 300, keepAlive: true }, socket);
      expect(response.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    });

    it.each([
      ['a client that wants it closed', { keepAlive: false }],
      ['a server that is stopping', { keepAlive: true, closing: true }],
      ['a middleware that asked the client to move on', { keepAlive: true, connectionHeader: 'close' }],
    ])('is closed for %s', async (_name, overrides) => {
      const { handOff, message, lease, socket, response } = setup(overrides);

      await handOff.start(message);

      expect(lease.handOff).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE_HANDOFF, requestId: 'r1', timeout: 300, keepAlive: false }, socket);
      expect(response.setHeader).toHaveBeenCalledWith('Connection', 'close');
    });

    it('goes to the http server again when the worker gives it back, and frees the response', async () => {
      const { handOff, message, httpServer } = setup({ keepAlive: true });
      const emit = jest.spyOn(httpServer, 'emit');
      const back = new net.Socket();
      sockets.push(back);
      await handOff.start(message);

      handOff.takeBack(back, Buffer.from('GET'));

      expect(handOff.isActive()).toBe(false);
      expect(emit).toHaveBeenCalledWith('connection', back);
      expect(back.readableLength).toBe(3);
    });

    it('is closed when the worker gives it back after the server stopped accepting connections', async () => {
      const { handOff, message, httpServer, stopAccepting } = setup({ keepAlive: true });
      const emit = jest.spyOn(httpServer, 'emit');
      const back = new net.Socket();
      await handOff.start(message);
      stopAccepting();

      handOff.takeBack(back, Buffer.alloc(0));

      expect(emit).not.toHaveBeenCalledWith('connection', back);
      expect(back.destroyed).toBe(true);
    });
  });

  const refusals: Array<[string, Overrides]> = [
    ['a connection that is encrypted, as the state of TLS lives in this process', { encrypted: true }],
    ['a request of HTTP/2', { httpVersionMajor: 2 }],
    ['a response to HEAD', { method: 'HEAD' }],
    ['a request whose body is still coming in', { streamsBody: true }],
    ['a response whose head is out already', { headersSent: true }],
    ['a response below the length', { minimumLength: 101 }],
    ['a response when the handing over is off', { minimumLength: 0 }],
    ['a response without a length', { head: { headers: {} } }],
    ['a response that is sent in chunks', { head: { headers: { 'Content-Length': '100', 'Transfer-Encoding': 'chunked' } } }],
    ['a status that has no body: 204', { head: { statusCode: 204 } }],
    ['a status that has no body: 205', { head: { statusCode: 205 } }],
    ['a status that has no body: 304', { head: { statusCode: 304 } }],
    ['an informational status: 100', { head: { statusCode: 100 } }],
    ['an informational status: 101', { head: { statusCode: 101 } }],
  ];

  it.each(refusals)('keeps %s, which the worker then streams through the server', async (_name, overrides) => {
    const { handOff, message, lease, response, onHandedOver } = setup(overrides);

    await handOff.start(message);

    expect(lease.send).toHaveBeenCalledWith(refused);
    expect(lease.handOff).not.toHaveBeenCalled();
    expect(onHandedOver).not.toHaveBeenCalled();
    expect(response.writeHead).not.toHaveBeenCalled();
    expect(handOff.isActive()).toBe(false);
  });

  it('keeps a connection that is destroyed already', async () => {
    const socket = createSocket();
    Object.defineProperty(socket, 'destroyed', { value: true });
    const { handOff, message, lease } = setup({ socket });

    await handOff.start(message);

    expect(lease.send).toHaveBeenCalledWith(refused);
    expect(lease.handOff).not.toHaveBeenCalled();
  });

  it('is not active after the worker is done, but the response stays marked as handed over', async () => {
    const { handOff, message, response } = setup();
    await handOff.start(message);

    handOff.finish();

    expect(handOff.isActive()).toBe(false);
    expect(handedOffResponses.has(response as unknown as Response)).toBe(true);
  });
});
