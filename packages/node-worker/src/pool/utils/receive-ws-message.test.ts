import { WORKER_EVENT } from '../constants';
import receiveWsMessage from './receive-ws-message';
import { createTestEnvironment } from './worker-environment.test-helper';

const message = (body: string | Buffer, requestId = 'r') => ({ type: WORKER_EVENT.WS_MESSAGE_RECEIVE as const, requestId, event: { body } });

const setup = (worker: jest.Mock) => {
  const test = createTestEnvironment({ worker });
  test.contexts.open('r').webSocket = { event: { path: '/ws' } as never, stream: { waiting: [], aborted: false } };

  return test;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('receiveWsMessage', () => {
  it('calls the worker with the frame and acknowledges once it is done', async () => {
    const worker = jest.fn().mockResolvedValue(undefined);
    const { env, send, contexts } = setup(worker);

    receiveWsMessage(env, message('hi'));
    await contexts.get('r')?.receiving;

    expect(worker.mock.calls[0][0]).toMatchObject({ path: '/ws', frame: 'hi' });
    expect(send).toHaveBeenCalledWith({ type: WORKER_EVENT.WS_MESSAGE_ACKNOWLEDGE, requestId: 'r' });
  });

  it('passes a binary message as binaryFrame', async () => {
    const worker = jest.fn().mockResolvedValue(undefined);
    const { env, contexts } = setup(worker);

    receiveWsMessage(env, message(Buffer.from('ab')));
    await contexts.get('r')?.receiving;

    expect(worker.mock.calls[0][0]).toMatchObject({ binaryFrame: Buffer.from('ab') });
  });

  it('handles the messages one after the other, in the order they came in', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const worker = jest.fn(async ({ frame }: { frame: string }) => {
      order.push(`start ${frame}`);
      if (frame === 'first') await new Promise<void>((resolve) => (release = resolve));
      order.push(`end ${frame}`);
    });
    const { env, contexts } = setup(worker);

    receiveWsMessage(env, message('first'));
    receiveWsMessage(env, message('second'));
    await settle();
    expect(order).toEqual(['start first']);

    release();
    await contexts.get('r')?.receiving;

    expect(order).toEqual(['start first', 'end first', 'start second', 'end second']);
  });

  it('sends what the worker answers with sendWsMessage', async () => {
    const worker = jest.fn(async (_event: unknown, callback: (event: unknown) => unknown) => {
      callback({ sendWsMessage: true, frame: 'HI' });
    });
    const { env, send, contexts } = setup(worker);

    receiveWsMessage(env, message('hi'));
    await contexts.get('r')?.receiving;

    expect(send).toHaveBeenCalledWith({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId: 'r', event: { body: 'HI' } });
  });

  it('reports any other answer, and acknowledges a message the worker failed on', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const worker = jest.fn(async (_event: unknown, callback: (event: unknown) => unknown) => {
      callback({ statusCode: 200 });
      throw new Error('fails');
    });
    const { env, send, contexts } = setup(worker);

    receiveWsMessage(env, message('hi'));
    await contexts.get('r')?.receiving;

    expect(error).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ type: WORKER_EVENT.WS_MESSAGE_ACKNOWLEDGE, requestId: 'r' });
    error.mockRestore();
  });

  it('skips a message of a connection that is closed', async () => {
    const worker = jest.fn();
    const { env, contexts } = createTestEnvironment({ worker });

    receiveWsMessage(env, message('hi'));
    await contexts.get('r')?.receiving;

    expect(worker).not.toHaveBeenCalled();
  });
});
