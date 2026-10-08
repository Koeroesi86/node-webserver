import fs from 'fs';
import tls from 'tls';
import setupSecureContexts from './setupSecureContexts';
import type { ServerInstance } from '../types';

const instance = (extra: Partial<ServerInstance>): ServerInstance => ({ hostname: 'secure.localhost', protocol: 'https', ...extra });
const certificate = (name: string) => `-----BEGIN CERTIFICATE-----\n${name}\n-----END CERTIFICATE-----`;

describe('setupSecureContexts', () => {
  const secureContext = {} as tls.SecureContext;

  beforeEach(() => {
    jest.spyOn(tls, 'createSecureContext').mockReturnValue(secureContext);
    jest.spyOn(fs, 'readFileSync').mockImplementation((file) => (file === '/ca.pem' ? `${certificate('one')}\n${certificate('two')}\n` : `content of ${file}`));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the instances, also when there are none', () => {
    expect(setupSecureContexts()).toEqual([]);
    expect(setupSecureContexts([])).toEqual([]);
  });

  it('creates a secure context for an instance with a key and a certificate', () => {
    const [result] = setupSecureContexts([instance({ key: '/key.pem', cert: '/cert.pem' })]);

    expect(result.secureContext).toBe(secureContext);
    expect(tls.createSecureContext).toHaveBeenCalledWith({ key: 'content of /key.pem', cert: 'content of /cert.pem', ca: undefined });
  });

  it('leaves the instances without a key or a certificate alone', () => {
    const result = setupSecureContexts([instance({ key: '/key.pem' }), instance({ cert: '/cert.pem' }), instance({ protocol: 'http' })]);

    expect(result.map(({ secureContext: context }) => context)).toEqual([undefined, undefined, undefined]);
    expect(tls.createSecureContext).not.toHaveBeenCalled();
  });

  it('splits a bundle of authorities into the certificates', () => {
    setupSecureContexts([instance({ key: '/key.pem', cert: '/cert.pem', ca: '/ca.pem' })]);

    expect(jest.mocked(tls.createSecureContext).mock.calls[0][0]?.ca).toEqual([certificate('one'), certificate('two')]);
  });
});
