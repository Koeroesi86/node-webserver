import isFrontMessage from './is-front-message';

describe('isFrontMessage', () => {
  it.each(['hello', 'ready', 'failed', 'stale', 'plan', 'prepared', 'prepare-failed', 'files', 'reload-request'].map((nodeWebserver) => [{ nodeWebserver }]))(
    'takes %j',
    (message) => {
      expect(isFrontMessage(message)).toBe(true);
    }
  );

  it.each([['ready'], [null], [{}], [{ nodeWebserver: 'commit' }]])('leaves out %j', (message) => {
    expect(isFrontMessage(message)).toBe(false);
  });
});
