import sendToParent from './sendToParent';

describe('sendToParent', () => {
  const originalSend = process.send;

  afterEach(() => {
    process.send = originalSend;
  });

  it('sends the message through the IPC channel', () => {
    const send = jest.fn();
    process.send = send;
    sendToParent({ type: 'a', id: '1' });

    expect(send).toHaveBeenCalledWith({ type: 'a', id: '1' });
  });

  it('throws when there is no parent to send to', () => {
    process.send = undefined;

    expect(() => sendToParent({ type: 'a' })).toThrow('There is no IPC channel to the parent process.');
  });
});
