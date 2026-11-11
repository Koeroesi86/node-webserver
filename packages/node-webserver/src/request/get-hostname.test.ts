import getHostname from './get-hostname';

describe('getHostname', () => {
  it.each([
    ['web.localhost', 'web.localhost'],
    ['web.localhost:8080', 'web.localhost'],
    ['Web.LocalHost', 'web.localhost'],
    ['[::1]', '[::1]'],
    ['[::1]:8443', '[::1]'],
  ])('reads %s as %s', (host, hostname) => {
    expect(getHostname(host)).toBe(hostname);
  });

  it('has nothing for a request without a host', () => {
    expect(getHostname(undefined)).toBeUndefined();
    expect(getHostname('')).toBeUndefined();
  });
});
