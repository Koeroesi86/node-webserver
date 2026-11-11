import findProxyProblems from './find-proxy-problems';
import type { ProxyOptions } from '../types';

const find = (proxyOptions?: ProxyOptions) =>
  findProxyProblems({ hostname: 'a.localhost', protocol: 'http', type: 'proxy', proxyOptions }, 's').map(({ setting, message }) => `${setting} ${message}`);

describe('findProxyProblems', () => {
  afterEach(() => {
    delete process.env.PROXY_PROBLEMS_TOKEN;
  });

  it('finds nothing for a target that is a URL, or a dynamic one with a token', () => {
    process.env.PROXY_PROBLEMS_TOKEN = 'secret';

    expect(find({ target: 'http://localhost:3000' })).toEqual([]);
    expect(find({ dynamic: { token: 'secret' } })).toEqual([]);
    expect(find({ dynamic: { tokenEnv: 'PROXY_PROBLEMS_TOKEN' } })).toEqual([]);
  });

  it('finds nothing without options, as the schema requires them', () => {
    expect(find()).toEqual([]);
  });

  it('finds no target, and both kinds of target', () => {
    expect(find({})).toEqual(['proxyOptions needs either a target or a dynamic one']);
    expect(find({ target: 'http://localhost', dynamic: { token: 'x' } })).toEqual(['proxyOptions needs either a target or a dynamic one']);
  });

  it('finds a target that is not a URL', () => {
    expect(find({ target: 'localhost' })).toEqual(['proxyOptions.target is not a URL: localhost']);
  });

  it('finds a dynamic target without a token, also when the variable of it is not set', () => {
    expect(find({ dynamic: {} })).toEqual(['proxyOptions.dynamic needs a token, or the environment variable of it (tokenEnv) set']);
    expect(find({ dynamic: { tokenEnv: 'PROXY_PROBLEMS_TOKEN' } })).toHaveLength(1);
  });

  it('names a file of authorities that is not there', () => {
    expect(find({ target: 'https://localhost', ca: '/none/ca.pem' })).toEqual(['proxyOptions.ca is not a file: /none/ca.pem']);
  });
});
