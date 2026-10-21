import { InternalServerError, WORKER_EVENT } from '../constants';
import createResponseSender from './create-response-sender';
import toResponseMessage from './to-response-message';
import { createTestEnvironment } from './worker-environment.test-helper';

const response = { statusCode: 200, headers: {}, body: 'ok', isBase64Encoded: false };
const part = (body: string | null) => ({ ...response, body, emit: true as const });
const stream = () => ({ waiting: [] as Array<(proceed: boolean) => void>, aborted: false });

describe('createResponseSender', () => {
  describe('sendResponse', () => {
    it('sends the response and drops the request', () => {
      const { env, send, contexts } = createTestEnvironment();
      contexts.open('r').stream = stream();

      createResponseSender(env).sendResponse('r', response);

      expect(send).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE, requestId: 'r', event: toResponseMessage(response) });
      expect(contexts.size).toBe(0);
    });

    it('keeps the websocket of an upgrade, and ends it with any other answer', () => {
      const { env, contexts } = createTestEnvironment();
      const { sendResponse } = createResponseSender(env);
      contexts.open('r').webSocket = { event: {} as never, stream: stream() };

      sendResponse('r', { ...response, statusCode: 101 });
      expect(contexts.get('r')?.webSocket).toBeDefined();

      sendResponse('r', response);
      expect(contexts.size).toBe(0);
    });

    it('destroys the rest of the request body and the open questions for metrics once the response is complete', () => {
      const { env, contexts } = createTestEnvironment();
      const destroy = jest.fn();
      const context = contexts.open('r');
      context.upload = { stream: { destroy } as never, receive: jest.fn() };
      context.metricsWaiting.push(jest.fn());

      createResponseSender(env).sendResponse('r', response);

      expect(destroy).toHaveBeenCalledTimes(1);
      expect(contexts.size).toBe(1);
    });

    it('answers 500 instead of a response that is too big for a frame', () => {
      const { env, send } = createTestEnvironment();
      send.mockReturnValueOnce(false);
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      createResponseSender(env).sendResponse('r', response);

      expect(send).toHaveBeenLastCalledWith({ type: WORKER_EVENT.RESPONSE, requestId: 'r', event: toResponseMessage(InternalServerError) });
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
    });

    it('does not answer 500 into a channel that is closed', () => {
      const { env, send } = createTestEnvironment({ isWritable: () => false });
      send.mockReturnValue(false);

      createResponseSender(env).sendResponse('r', response);

      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendResponsePart', () => {
    it('registers the stream before sending, so that a late acknowledgement finds it, and resolves with the acknowledgement', async () => {
      const { env, send, contexts } = createTestEnvironment();
      const target = stream();

      const sent = createResponseSender(env).sendResponsePart('r', target, part('one'));

      expect(contexts.get('r')?.stream).toBe(target);
      expect(send).toHaveBeenCalledWith({ type: WORKER_EVENT.RESPONSE_EMIT, requestId: 'r', event: toResponseMessage(part('one')) });
      target.waiting.shift()?.(true);
      expect(await sent).toBe(true);
      expect(contexts.get('r')?.stream).toBe(target);
    });

    it('drops the stream when the acknowledgement of the last part comes in', async () => {
      const { env, contexts } = createTestEnvironment();
      const target = stream();

      const sent = createResponseSender(env).sendResponsePart('r', target, part(null));
      expect(contexts.get('r')?.stream).toBe(target);
      target.waiting.shift()?.(true);

      expect(await sent).toBe(true);
      expect(contexts.size).toBe(0);
    });

    it('resolves with false for a request that is aborted, without sending', async () => {
      const { env, send } = createTestEnvironment();

      expect(await createResponseSender(env).sendResponsePart('r', { waiting: [], aborted: true }, part('one'))).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('resolves with false for a part that is too big', async () => {
      const { env, send } = createTestEnvironment();
      send.mockReturnValue(false);
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(await createResponseSender(env).sendResponsePart('r', stream(), part('one'))).toBe(false);
      error.mockRestore();
    });
  });
});
