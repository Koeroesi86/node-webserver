import { WORKER_EVENT, type RequestEvent, type WorkerLease } from '@koeroesi86/node-worker-pool';
import { EventEmitter } from 'events';
import type { Request } from 'express';
import attachWebSocket from './attach-web-socket';

const webSocket = { receive: jest.fn(), dispose: jest.fn() };
jest.mock('./create-ws-connection', () => ({ __esModule: true, default: jest.fn(() => webSocket) }));

const event = { path: '/a' } as unknown as RequestEvent;

const setup = () => {
  const socket = new EventEmitter();
  const lease = { send: jest.fn() };
  const undo: Array<() => void> = [];
  const onClose = jest.fn();

  attachWebSocket({
    request: { socket } as unknown as Request,
    lease: lease as unknown as WorkerLease,
    requestId: 'r1',
    event,
    options: { limitWebSocketMessage: 0, webSocketPingInterval: 0, limitWebSocketIdleTimeout: 0 },
    onClose,
    addUndo: (fn) => undo.push(fn),
  });

  return { socket, lease, undo, onClose };
};

describe('attachWebSocket', () => {
  it('passes the data of the socket to the connection', () => {
    const { socket } = setup();
    socket.emit('data', Buffer.from('a'));
    expect(webSocket.receive).toHaveBeenCalledWith(Buffer.from('a'));
  });

  it('tells the worker and the request about the close of the client', () => {
    const { socket, lease, onClose } = setup();
    socket.emit('close');
    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.WS_CONNECTION_CLOSE, requestId: 'r1', event });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves no listener on the socket once undone, and disposes the connection', () => {
    const { socket, undo } = setup();
    undo.forEach((fn) => fn());
    expect(socket.listenerCount('data')).toBe(0);
    expect(socket.listenerCount('close')).toBe(0);
    expect(webSocket.dispose).toHaveBeenCalled();
  });
});
