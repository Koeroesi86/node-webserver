import getTargetKey from './get-target-key';

describe('getTargetKey', () => {
  it('names a server with a dynamic target by its protocol and host', () => {
    expect(getTargetKey({ hostname: 'a.localhost', protocol: 'https', type: 'proxy', proxyOptions: { dynamic: {} } })).toBe('https a.localhost');
  });

  it.each([
    [{ type: 'proxy' as const, proxyOptions: { target: 'http://a.localhost' } }],
    [{ type: 'proxy' as const }],
    [{ type: 'worker' as const, proxyOptions: { dynamic: {} } }],
  ])('has no name for %j', (extra) => {
    expect(getTargetKey({ hostname: 'a.localhost', protocol: 'http', ...extra })).toBeUndefined();
  });
});
