import { WORKER_EVENT } from '../constants';
import createRequestContexts from './create-request-contexts';
import createUpload from './create-upload';

const setup = () => {
  const send = jest.fn(() => true);
  const contexts = createRequestContexts();

  return { send, contexts, stream: createUpload(contexts, { send }, 'r') };
};
const acknowledgement = { type: WORKER_EVENT.REQUEST_BODY_ACKNOWLEDGE, requestId: 'r' };

describe('createUpload', () => {
  it('registers the upload with the context of the request', () => {
    const { contexts, stream } = setup();

    expect(contexts.get('r')?.upload?.stream).toBe(stream);
  });

  it('acknowledges a part the reader has room for, and ends the stream with the last part', async () => {
    const { send, contexts, stream } = setup();
    const received = new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });

    contexts.get('r')?.upload?.receive({ body: Buffer.from('ab') });
    contexts.get('r')?.upload?.receive({ body: null });

    expect(await received).toBe('ab');
    expect(send).toHaveBeenCalledWith(acknowledgement);
    expect(contexts.size).toBe(0);
  });

  it('holds back the acknowledgement of a part the reader is too far behind for, until it reads', () => {
    const { send, contexts, stream } = setup();

    contexts.get('r')?.upload?.receive({ body: Buffer.alloc(64 * 1024) });
    expect(send).not.toHaveBeenCalled();

    stream.read();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(acknowledgement);
  });

  it('leaves the context when the stream is destroyed, and an error does not take the process down', () => {
    const { contexts, stream } = setup();

    stream.destroy(new Error('cut off'));

    expect(contexts.size).toBe(0);
  });
});
