import { WORKER_EVENT } from '../constants';
import sendWsMessage from './send-ws-message';
import { createTestEnvironment } from './worker-environment.test-helper';

describe('sendWsMessage', () => {
  const stream = () => ({ waiting: [] as Array<(proceed: boolean) => void>, aborted: false });

  it('sends the frame, registers the stream for the acknowledgements and resolves once the server wrote it', async () => {
    const { env, send, contexts } = createTestEnvironment();
    const target = stream();

    const sent = sendWsMessage(env, 'r', target, { sendWsMessage: true, frame: 'hi' });

    expect(send).toHaveBeenCalledWith({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId: 'r', event: { body: 'hi' } });
    expect(contexts.get('r')?.stream).toBe(target);
    target.waiting.shift()?.(true);
    expect(await sent).toBe(true);
  });

  it('sends the close and does not wait for it', async () => {
    const { env, send } = createTestEnvironment();

    expect(await sendWsMessage(env, 'r', stream(), { sendWsMessage: true, close: { code: 4000, reason: 'bye' } })).toBe(false);
    expect(send).toHaveBeenCalledWith({ type: WORKER_EVENT.WS_MESSAGE_SEND, requestId: 'r', event: { close: { code: 4000, reason: 'bye' } } });
  });

  it('sends nothing to a connection that is gone', async () => {
    const { env, send } = createTestEnvironment();

    expect(await sendWsMessage(env, 'r', undefined, { sendWsMessage: true, frame: 'hi' })).toBe(false);
    expect(await sendWsMessage(env, 'r', { waiting: [], aborted: true }, { sendWsMessage: true, frame: 'hi' })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a message that is too big, and resolves with false', async () => {
    const { env, send } = createTestEnvironment();
    send.mockReturnValue(false);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(await sendWsMessage(env, 'r', stream(), { sendWsMessage: true, frame: 'hi' })).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('does not report a message into a channel that is closed', async () => {
    const { env, send } = createTestEnvironment({ isWritable: () => false });
    send.mockReturnValue(false);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(await sendWsMessage(env, 'r', stream(), { sendWsMessage: true, frame: 'hi' })).toBe(false);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
