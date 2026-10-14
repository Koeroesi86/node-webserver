import type { Request } from 'express';
import getClientIp from './getClientIp';

const request = (headers: Record<string, string | string[]>, { ip, remoteAddress }: { ip?: string; remoteAddress?: string } = {}) =>
  ({ headers, ip, socket: { remoteAddress } }) as unknown as Request;

describe('getClientIp', () => {
  it('gives the address the app resolved', () => {
    expect(getClientIp(request({}, { ip: '1.2.3.4', remoteAddress: '10.0.0.1' }))).toBe('1.2.3.4');
  });

  it('falls back to the address of the socket', () => {
    expect(getClientIp(request({}, { remoteAddress: '3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('gives an empty string when there is nothing to tell', () => {
    expect(getClientIp(request({}))).toBe('');
  });

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
  ])('ignores %s set by a direct client', (header) => {
    expect(getClientIp(request({ [header]: '6.6.6.6' }, { ip: '3.3.3.3', remoteAddress: '3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('gives a mapped IPv4 address as IPv4, as the access logs do', () => {
    expect(getClientIp(request({}, { ip: '::ffff:1.2.3.4' }))).toBe('1.2.3.4');
    expect(getClientIp(request({}, { ip: '2001:db8::1' }))).toBe('2001:db8::1');
  });
});
