import path from 'path';
import getWatchedFiles from './get-watched-files';
import type { LoadedInstance, ServerInstance } from '../types';

const loaded = (instance: ServerInstance, files: string[] = []): LoadedInstance => ({
  source: instance,
  instance,
  files,
  handler: jest.fn(),
  close: jest.fn(),
});

describe('getWatchedFiles', () => {
  it('includes the key, the certificate and the authorities of the servers, so that a renewed certificate loads the servers again', () => {
    const secure = loaded({ hostname: 'secure.localhost', protocol: 'https', key: '/certs/key.pem', cert: '/certs/cert.pem', ca: '/certs/ca.pem' });

    expect(getWatchedFiles([], [secure])).toEqual(['/certs/key.pem', '/certs/cert.pem', '/certs/ca.pem']);
  });

  it('leaves out what a server does not have', () => {
    const plain = loaded({ hostname: 'plain.localhost', protocol: 'http' });
    const withoutAuthority = loaded({ hostname: 'secure.localhost', protocol: 'https', key: '/certs/key.pem', cert: '/certs/cert.pem' });

    expect(getWatchedFiles([], [plain, withoutAuthority])).toEqual(['/certs/key.pem', '/certs/cert.pem']);
  });

  it('includes the files of the servers given as paths, also the ones that do not exist yet, and the files they loaded', () => {
    const server = loaded({ hostname: 'a.localhost', protocol: 'http' }, ['/servers/a.js', '/servers/hostname.js']);

    expect(getWatchedFiles(['servers/a.js', 'servers/not-yet.js'], [server])).toEqual([
      path.resolve('servers/a.js'),
      path.resolve('servers/not-yet.js'),
      '/servers/a.js',
      '/servers/hostname.js',
    ]);
  });

  it('does not watch the servers defined in the configuration itself', () => {
    expect(getWatchedFiles([{ hostname: 'inline.localhost', protocol: 'http' }], [])).toEqual([]);
  });
});
