import net from 'net';
import { WORKER_EVENT } from '../constants';
import sendHandBack from './send-hand-back';

describe('sendHandBack', () => {
  const message = { type: WORKER_EVENT.REQUEST_HANDBACK as const, requestId: 'a', event: { statusCode: 200 }, leftover: '' };
  const socket = new net.Socket();
  const original = { send: process.send, connected: process.connected };

  afterEach(() => {
    Object.assign(process, original);
  });

  it('sends the message with the connection over the IPC channel', async () => {
    const send = jest.fn((_message: unknown, _handle: unknown, callback: (error: Error | null) => void) => {
      callback(null);

      return true;
    });
    Object.assign(process, { send, connected: true });

    await expect(sendHandBack(message, socket)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(message, socket, expect.any(Function));
  });

  it('rejects when the channel could not send it', async () => {
    const send = jest.fn((_message: unknown, _handle: unknown, callback: (error: Error | null) => void) => {
      callback(new Error('closed'));

      return false;
    });
    Object.assign(process, { send, connected: true });

    await expect(sendHandBack(message, socket)).rejects.toThrow('closed');
  });

  it.each([
    ['the process has no IPC channel', { send: undefined, connected: false }],
    ['the channel is closed', { send: jest.fn(), connected: false }],
  ])('rejects when %s', async (_name, state) => {
    Object.assign(process, state);

    await expect(sendHandBack(message, socket)).rejects.toThrow('The worker has no IPC channel.');
  });
});
