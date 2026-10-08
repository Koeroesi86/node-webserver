import type { Request } from 'express';
import getClientIp from './getClientIp';

const request = (headers: Record<string, string | string[]>, remoteAddress?: string) => ({ headers, socket: { remoteAddress } } as unknown as Request);

describe('getClientIp', () => {
  it.each([
    'x-client-ip',
    'x-forwarded-for',
    'cf-connecting-ip',
    'fastly-client-ip',
    'true-client-ip',
    'x-real-ip',
    'x-cluster-client-ip',
    'x-forwarded',
    'forwarded-for',
    'forwarded',
  ])('reads the address from %s', (header) => {
    expect(getClientIp(request({ [header]: '1.2.3.4' }))).toBe('1.2.3.4');
  });

  it('prefers the headers in order, over the address of the socket', () => {
    expect(getClientIp(request({ 'x-real-ip': '2.2.2.2', 'x-client-ip': '1.1.1.1' }, '3.3.3.3'))).toBe('1.1.1.1');
    expect(getClientIp(request({ 'x-real-ip': '2.2.2.2' }, '3.3.3.3'))).toBe('2.2.2.2');
  });

  it('takes the first of a header that comes more than once', () => {
    expect(getClientIp(request({ 'x-client-ip': ['1.1.1.1', '2.2.2.2'] }))).toBe('1.1.1.1');
  });

  it('falls back to the address of the socket', () => {
    expect(getClientIp(request({}, '3.3.3.3'))).toBe('3.3.3.3');
  });

  it('gives an empty string when there is nothing to tell', () => {
    expect(getClientIp(request({}))).toBe('');
  });
});
