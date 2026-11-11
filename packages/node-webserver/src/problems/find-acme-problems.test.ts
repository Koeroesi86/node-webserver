import fs from 'fs';
import os from 'os';
import path from 'path';
import findAcmeProblems from './find-acme-problems';
import type { AcmeOptions, ServerConfig } from '../types';

const acme: AcmeOptions = { email: 'admin@example.com', storagePath: '/var/lib/nws' };

const find = (overrides: Partial<ServerConfig>) =>
  findAcmeProblems({ hostname: 'secure.example.com', protocol: 'https', acme, ...overrides }, 's').map(({ setting, message }) => `${setting} ${message}`);

describe('findAcmeProblems', () => {
  it('finds nothing for an https server with the defaults, a directory or without acme', () => {
    expect(find({})).toEqual([]);
    expect(find({ acme: { ...acme, directory: 'https://localhost:14000/dir' } })).toEqual([]);
    expect(find({ acme: undefined, hostname: '*.example.com', protocol: 'http' })).toEqual([]);
  });

  it('finds acme on an http server', () => {
    expect(find({ protocol: 'http' })).toEqual(['acme is for an https server']);
  });

  it('finds a wildcard, which only the dns-01 challenge can prove', () => {
    expect(find({ hostname: '*.example.com' })).toEqual([expect.stringMatching(/^acme cannot get a certificate for a host name with a wildcard/)]);
  });

  it('finds a name that cannot be a folder of the storage', () => {
    expect(find({ hostname: '../etc' })).toEqual([expect.stringMatching(/^hostname needs letters, digits/)]);
    expect(find({ hostname: 'a b.example.com' })).toEqual([expect.stringMatching(/^hostname needs letters/)]);
  });

  it('wants a directory that is an https URL', () => {
    expect(find({ acme: { ...acme, directory: 'http://localhost/dir' } })).toEqual(['acme.directory is not an https URL: http://localhost/dir']);
    expect(find({ acme: { ...acme, directory: 'letsencrypt' } })).toEqual(['acme.directory is not an https URL: letsencrypt']);
  });

  it('wants the certificates of the directory to be a file', () => {
    const missing = path.join(os.tmpdir(), 'no-acme-ca.pem');
    expect(fs.existsSync(missing)).toBe(false);

    expect(find({ acme: { ...acme, directoryCa: missing } })).toEqual([`acme.directoryCa is not a file: ${missing}`]);
  });
});
