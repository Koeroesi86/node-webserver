import findRedirectProblems from './find-redirect-problems';
import type { ServerConfig } from '../types';

const find = (overrides: Partial<ServerConfig>) =>
  findRedirectProblems({ hostname: 'a.localhost', protocol: 'https', ...overrides }, 's').map(({ setting, message }) => `${setting} ${message}`);

describe('findRedirectProblems', () => {
  it('finds nothing on an https server, or without the settings', () => {
    expect(find({ redirectHttp: true, hsts: { maxAge: 60 } })).toEqual([]);
    expect(find({ protocol: 'http' })).toEqual([]);
    expect(find({ protocol: 'http', redirectHttp: false, hsts: false })).toEqual([]);
  });

  it('finds the settings on an http server', () => {
    expect(find({ protocol: 'http', redirectHttp: true, hsts: true })).toEqual(['redirectHttp is for an https server', 'hsts is for an https server']);
  });
});
