import fs from 'fs';
import os from 'os';
import path from 'path';
import validateServers from './validate-servers';
import type { ServerConfig } from '../types';

describe('validateServers', () => {
  let folder: string;

  beforeAll(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-servers-'));
  });

  afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

  const find = (...instances: object[]) =>
    validateServers(
      instances.map((instance, position) => ({
        source: position === 0 ? path.join(folder, 'first.js') : (instance as ServerConfig),
        instance: instance as ServerConfig,
      })),
      {}
    ).map(({ server, setting, message }) => `${server} ${setting} ${message.replace(folder, '<folder>').replaceAll('\\', '/')}`);

  it('finds nothing in servers that are valid', () => {
    expect(
      find({ hostname: 'a.localhost', protocol: 'http', type: 'worker', options: { root: folder } }, { hostname: 'b.localhost', protocol: 'http' })
    ).toEqual([]);
  });

  it('names the server by its file when it comes from one, and by its host when not', () => {
    expect(find({ hostname: 'a.localhost', protocol: 'http', typo: 1 }, { hostname: 'b.localhost', protocol: 'http', typo: 1 })).toEqual([
      `http://a.localhost (${path.join(folder, 'first.js')}) typo is not a setting`,
      'http://b.localhost typo is not a setting',
    ]);
  });

  it('finds the problems of every server together, of the schema, the files and between the servers', () => {
    expect(
      find(
        { hostname: 'a.localhost', protocol: 'http', type: 'worker', options: { root: path.join(folder, 'none'), limit: 'x' } },
        { hostname: 'b.localhost', protocol: 'https', type: 'proxy', proxyOptions: {} },
        { hostname: 'a.localhost', protocol: 'http' }
      ).map((line) => line.replace(`(${path.join(folder, 'first.js')}) `, ''))
    ).toEqual([
      'http://a.localhost options.limit must be integer',
      'http://a.localhost options.root is not a folder: <folder>/none',
      'https://b.localhost key an https server needs a key and a cert',
      'https://b.localhost proxyOptions needs either a target or a dynamic one',
      'http://a.localhost hostname is already served by http://a.localhost (<folder>/first.js)',
    ]);
  });

  it('still reports the others when the type of a setting breaks a finder', () => {
    expect(find({ hostname: 'a.localhost', protocol: 'http', type: 'worker', options: { root: 1, routes: 'x' } }).length).toBeGreaterThan(0);
  });
});
