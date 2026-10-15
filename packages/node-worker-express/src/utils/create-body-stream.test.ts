import createBodyStream from './create-body-stream';
import createRequestContexts from './create-request-contexts';

const read = async (stream: AsyncIterable<Buffer>) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);

  return Buffer.concat(chunks).toString();
};

describe('createBodyStream', () => {
  const setup = () => ({ contexts: createRequestContexts(), channel: { send: jest.fn(() => true) } });

  it('streams the parts that follow when the request has a body', () => {
    const { contexts, channel } = setup();

    const stream = createBodyStream(contexts, channel, 'r', true, undefined);

    expect(contexts.get('r')?.upload?.stream).toBe(stream);
  });

  it('streams the body that came with the request', async () => {
    const { contexts, channel } = setup();

    expect(await read(createBodyStream(contexts, channel, 'r', false, Buffer.from('inline')))).toBe('inline');
    expect(contexts.size).toBe(0);
  });

  it('gives no bytes to a request without a body, or with an empty one', async () => {
    const { contexts, channel } = setup();

    expect(await read(createBodyStream(contexts, channel, 'r', undefined, undefined))).toBe('');
    expect(await read(createBodyStream(contexts, channel, 'r', false, Buffer.alloc(0)))).toBe('');
  });
});
