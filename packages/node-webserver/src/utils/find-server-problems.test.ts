import fs from 'fs';
import os from 'os';
import path from 'path';
import findServerProblems from './find-server-problems';
import type { ServerConfig } from '../types';

describe('findServerProblems', () => {
  const folder = path.join(os.tmpdir(), 'no-such-acme-folder');
  const find = (settings: Partial<ServerConfig>) =>
    findServerProblems({ hostname: 'secure.example.com', protocol: 'https', ...settings }, 's').map(({ setting, message }) => `${setting} ${message}`);

  it('names the files of the key and certificate that are not there', () => {
    expect(fs.existsSync(folder)).toBe(false);

    expect(find({ key: path.join(folder, 'k.pem'), cert: path.join(folder, 'c.pem') })).toEqual([
      `key is not a file: ${path.join(folder, 'k.pem')}`,
      `cert is not a file: ${path.join(folder, 'c.pem')}`,
    ]);
  });

  it('leaves them to the acme server, which makes them when it starts', () => {
    expect(find({ key: path.join(folder, 'k.pem'), cert: path.join(folder, 'c.pem'), acme: { email: 'a@example.com', storagePath: folder } })).toEqual([]);
  });

  it('names what is wrong with acme', () => {
    expect(find({ protocol: 'http', acme: { email: 'a@example.com', storagePath: folder } })).toEqual(['acme is for an https server']);
  });
});
