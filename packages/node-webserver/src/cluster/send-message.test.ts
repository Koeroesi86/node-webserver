import sendMessage from './send-message';

describe('sendMessage', () => {
  const originalSend = process.send;

  afterEach(() => (process.send = originalSend));

  it('resolves once the message left, also with an error', async () => {
    const send = jest.fn((_message, _handle, _options, callback: (error: Error | null) => void) => callback(new Error('closed')));
    process.send = send as never;

    await sendMessage({ nodeWebserver: 'hello' });

    expect(send.mock.calls[0][0]).toEqual({ nodeWebserver: 'hello' });
  });

  it('resolves for a process that has no parent to send to', async () => {
    process.send = undefined;

    await expect(sendMessage({ nodeWebserver: 'serving' })).resolves.toBeUndefined();
  });
});
