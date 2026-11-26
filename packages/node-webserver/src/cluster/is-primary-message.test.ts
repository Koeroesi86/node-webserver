import isPrimaryMessage from './is-primary-message';

describe('isPrimaryMessage', () => {
  it.each(['signal', 'prepare', 'commit', 'discard', 'stop'].map((nodeWebserver) => [{ nodeWebserver }]))('takes %j', (message) => {
    expect(isPrimaryMessage(message)).toBe(true);
  });

  it.each([['stop'], [null], [{}], [{ nodeWebserver: 'ready' }]])('leaves out %j', (message) => {
    expect(isPrimaryMessage(message)).toBe(false);
  });
});
