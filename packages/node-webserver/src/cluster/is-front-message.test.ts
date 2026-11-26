import isFrontMessage from './is-front-message';

describe('isFrontMessage', () => {
  it.each([[{ nodeWebserver: 'hello' }], [{ nodeWebserver: 'ready' }], [{ nodeWebserver: 'failed' }], [{ nodeWebserver: 'stale' }]])('takes %j', (message) => {
    expect(isFrontMessage(message)).toBe(true);
  });

  it.each([['ready'], [null], [{}], [{ nodeWebserver: 'reload' }]])('leaves out %j', (message) => {
    expect(isFrontMessage(message)).toBe(false);
  });
});
