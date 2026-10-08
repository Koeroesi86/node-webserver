import getURL from './getURL';

describe('getURL', () => {
  it('leaves the port out when there is none', () => {
    expect(getURL('http', 'web.localhost')).toBe('http://web.localhost');
  });

  it('leaves the default port of the protocol out', () => {
    expect(getURL('http', 'web.localhost', 80)).toBe('http://web.localhost');
    expect(getURL('https', 'web.localhost', 443)).toBe('https://web.localhost');
  });

  it('shows a port that is not the default of the protocol', () => {
    expect(getURL('http', 'web.localhost', 8080)).toBe('http://web.localhost:8080');
    expect(getURL('https', 'web.localhost', 80)).toBe('https://web.localhost:80');
  });

  it('shows the port of a protocol without a default', () => {
    expect(getURL('ws', 'web.localhost', 80)).toBe('ws://web.localhost:80');
  });
});
