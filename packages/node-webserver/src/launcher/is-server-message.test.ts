import isServerMessage from './is-server-message';

describe('isServerMessage', () => {
  it.each([[{ nodeWebserver: 'hello' }], [{ nodeWebserver: 'serving' }]])('takes %j', (message) => {
    expect(isServerMessage(message)).toBe(true);
  });

  it.each([['serving'], [null], [{}], [{ nodeWebserver: 'ready' }]])('leaves out %j', (message) => {
    expect(isServerMessage(message)).toBe(false);
  });
});
