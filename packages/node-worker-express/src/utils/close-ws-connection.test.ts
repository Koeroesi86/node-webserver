import closeWsConnection from './close-ws-connection';
import createRequestContexts from './create-request-contexts';

describe('closeWsConnection', () => {
  const setup = () => {
    const contexts = createRequestContexts();
    const stream = { waiting: [jest.fn(), jest.fn()], aborted: false };
    const context = contexts.open('r');
    context.stream = stream;
    context.webSocket = { event: {} as never, stream };
    context.receiving = Promise.resolve();

    return { contexts, stream };
  };

  it('aborts the stream, tells the worker that waits that the message will not be taken and drops the context', () => {
    const { contexts, stream } = setup();
    const waiting = [...stream.waiting];

    closeWsConnection(contexts, 'r');

    expect(stream.aborted).toBe(true);
    expect(stream.waiting).toHaveLength(0);
    waiting.forEach((resolve) => expect(resolve).toHaveBeenCalledWith(false));
    expect(contexts.size).toBe(0);
  });

  it('keeps a stream the request has moved on to', () => {
    const { contexts } = setup();
    const other = { waiting: [], aborted: false };
    contexts.open('r').stream = other;

    closeWsConnection(contexts, 'r');

    expect(contexts.get('r')?.stream).toBe(other);
  });

  it('forgets the queue of received messages of a connection that has no stream', () => {
    const contexts = createRequestContexts();
    contexts.open('r').receiving = Promise.resolve();

    closeWsConnection(contexts, 'r');

    expect(contexts.size).toBe(0);
  });
});
