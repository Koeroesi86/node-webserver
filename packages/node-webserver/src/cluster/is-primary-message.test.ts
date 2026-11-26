import isPrimaryMessage from './is-primary-message';

describe('isPrimaryMessage', () => {
  it.each([[{ nodeWebserver: 'signal', signal: 'SIGTERM' }], [{ nodeWebserver: 'reload' }], [{ nodeWebserver: 'stop' }]])('takes %j', (message) => {
    expect(isPrimaryMessage(message)).toBe(true);
  });

  it.each([['reload'], [null], [{}], [{ nodeWebserver: 'ready' }]])('leaves out %j', (message) => {
    expect(isPrimaryMessage(message)).toBe(false);
  });
});
