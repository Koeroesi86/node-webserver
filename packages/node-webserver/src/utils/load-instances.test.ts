import fs from 'fs';
import os from 'os';
import path from 'path';
import tls from 'tls';
import createInstanceHandler from './create-instance-handler';
import loadInstances from './load-instances';
import type { ServerInstance } from '../types';

// a server starts processes, a handler that remembers whether it was stopped is enough here
jest.mock('./create-instance-handler', () => ({ __esModule: true, default: jest.fn(() => ({ handler: jest.fn(), close: jest.fn() })) }));

describe('loadInstances', () => {
  let folder: string;

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'load-instances-'));
    jest.mocked(createInstanceHandler).mockClear();
  });

  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  // the tests have a module registry of their own, which keeps the modules whatever node does with its cache, and knows nothing of the modules a module loaded:
  // it is emptied here, as the server empties the cache of node. The integration test loads a server again in node itself, with a module it loads.
  const write = (name: string, content: string) => {
    jest.resetModules();
    const file = path.join(folder, name);
    fs.writeFileSync(file, content);
    return file;
  };
  const server = (name: string, hostname: string) => write(name, `module.exports = { hostname: '${hostname}', protocol: 'http', type: 'worker' };`);

  it('loads the servers of the files and the ones of the configuration', () => {
    const inline: ServerInstance = { hostname: 'inline.localhost', protocol: 'http' };

    const loaded = loadInstances([server('a.js', 'a.localhost'), inline], []);

    expect(loaded.map(({ instance }) => instance.hostname)).toEqual(['a.localhost', 'inline.localhost']);
    expect(createInstanceHandler).toHaveBeenCalledTimes(2);
  });

  it('leaves out a file that does not exist', () => {
    expect(loadInstances([path.join(folder, 'missing.js')], [])).toEqual([]);
  });

  it('keeps a server whose files did not change, with what it started', () => {
    const inline: ServerInstance = { hostname: 'inline.localhost', protocol: 'http' };
    const servers = [server('a.js', 'a.localhost'), inline];
    const previous = loadInstances(servers, []);

    const loaded = loadInstances(servers, previous);

    expect(loaded).toEqual(previous);
    expect(loaded[0]).toBe(previous[0]);
    expect(loaded[1]).toBe(previous[1]);
    expect(createInstanceHandler).toHaveBeenCalledTimes(2);
  });

  it('picks up a changed file, and leaves stopping the old server to the caller', () => {
    const file = server('a.js', 'a.localhost');
    const previous = loadInstances([file], []);
    server('a.js', 'b.localhost');

    const loaded = loadInstances([file], previous);

    expect(loaded[0].instance.hostname).toBe('b.localhost');
    expect(loaded[0]).not.toBe(previous[0]);
    expect(previous[0].close).not.toHaveBeenCalled();
  });

  it('drops a server whose file was removed', () => {
    const file = server('a.js', 'a.localhost');
    const previous = loadInstances([file, server('b.js', 'b.localhost')], []);
    fs.rmSync(file);

    const loaded = loadInstances([file, path.join(folder, 'b.js')], previous);

    expect(loaded.map(({ instance }) => instance.hostname)).toEqual(['b.localhost']);
  });

  it('throws for a broken file, without starting anything', () => {
    const file = server('a.js', 'a.localhost');
    const previous = loadInstances([file, server('b.js', 'b.localhost')], []);
    write('b.js', 'module.exports = {');
    server('a.js', 'c.localhost');

    expect(() => loadInstances([file, path.join(folder, 'b.js')], previous)).toThrow('Unexpected');
    expect(createInstanceHandler).toHaveBeenCalledTimes(2);
  });

  it('throws for a file that does not export a server', () => {
    expect(() => loadInstances([write('a.js', `module.exports = { hostname: 'a.localhost' };`)], [])).toThrow('does not export a server');
  });

  it('stops the servers it started when another one fails to start', () => {
    const close = jest.fn();
    jest
      .mocked(createInstanceHandler)
      .mockReturnValueOnce({ handler: jest.fn(), close })
      .mockImplementationOnce(() => {
        throw new Error('options are required');
      });

    expect(() => loadInstances([server('a.js', 'a.localhost'), server('b.js', 'b.localhost')], [])).toThrow('options are required');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reads the certificates again for the servers that are kept, and starts nothing when one cannot be read', () => {
    const key = write('key.pem', 'key');
    const cert = write('cert.pem', 'one');
    const file = write('a.js', `module.exports = { hostname: 'a.localhost', protocol: 'https', key: ${JSON.stringify(key)}, cert: ${JSON.stringify(cert)} };`);
    // the files are no real key and certificate, an empty context stands in for theirs
    const emptyContext = tls.createSecureContext();
    const createSecureContext = jest.spyOn(tls, 'createSecureContext').mockReturnValue(emptyContext);
    const previous = loadInstances([file], []);
    write('cert.pem', 'two');

    const loaded = loadInstances([file], previous);
    fs.rmSync(cert);

    expect(loaded[0]).toBe(previous[0]);
    expect(createSecureContext).toHaveBeenLastCalledWith(expect.objectContaining({ cert: 'two' }));
    expect(() => loadInstances([file], loaded)).toThrow('ENOENT');
    expect(createInstanceHandler).toHaveBeenCalledTimes(1);
  });
});
