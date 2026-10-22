import fs from 'fs';
import os from 'os';
import path from 'path';
import tls from 'tls';
import createInstanceHandler from './create-instance-handler';
import loadInstances from './load-instances';
import createMockLogger from '../utils/mock-logger.test-helper';
import type { ServerConfig } from '../types';

// a server starts processes, a handler that remembers whether it was stopped is enough here
// the files of the certificates are no real ones here, an empty context stands in for theirs
jest.mock('../utils/find-certificate-problems', () => ({ __esModule: true, default: () => [] }));
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
  const server = (name: string, hostname: string) => write(name, `module.exports = { hostname: '${hostname}', protocol: 'http' };`);

  it('loads the servers of the files and the ones of the configuration', () => {
    const inline: ServerConfig = { hostname: 'inline.localhost', protocol: 'http' };

    const loaded = loadInstances([server('a.js', 'a.localhost'), inline], [], createMockLogger());

    expect(loaded.map(({ instance }) => instance.hostname)).toEqual(['a.localhost', 'inline.localhost']);
    expect(createInstanceHandler).toHaveBeenCalledTimes(2);
  });

  it('gives an acme server the files of its certificate, and loads it before the certificate is there', () => {
    const acme = { email: 'admin@example.com', storagePath: path.join(folder, 'acme') };
    const definition: ServerConfig = { hostname: 'secure.example.com', protocol: 'https', acme };

    const [loaded] = loadInstances([definition], [], createMockLogger());

    expect(loaded.instance).toMatchObject({
      key: path.join(acme.storagePath, 'secure.example.com', 'privkey.pem'),
      cert: path.join(acme.storagePath, 'secure.example.com', 'fullchain.pem'),
    });
    expect(loaded.runtime.secureContext).toBeUndefined();
    expect(definition.key).toBeUndefined();
  });

  it('leaves out a file that does not exist', () => {
    expect(loadInstances([path.join(folder, 'missing.js')], [], createMockLogger())).toEqual([]);
  });

  it('keeps a server whose files did not change, with what it started', () => {
    const inline: ServerConfig = { hostname: 'inline.localhost', protocol: 'http' };
    const servers = [server('a.js', 'a.localhost'), inline];
    const previous = loadInstances(servers, [], createMockLogger());

    const loaded = loadInstances(servers, previous, createMockLogger());

    expect(loaded).toEqual(previous);
    expect(loaded[0]).toBe(previous[0]);
    expect(loaded[1]).toBe(previous[1]);
    expect(createInstanceHandler).toHaveBeenCalledTimes(2);
  });

  it('picks up a changed file, and leaves stopping the old server to the caller', () => {
    const file = server('a.js', 'a.localhost');
    const previous = loadInstances([file], [], createMockLogger());
    server('a.js', 'b.localhost');

    const loaded = loadInstances([file], previous, createMockLogger());

    expect(loaded[0].instance.hostname).toBe('b.localhost');
    expect(loaded[0]).not.toBe(previous[0]);
    expect(previous[0].close).not.toHaveBeenCalled();
  });

  it('drops a server whose file was removed', () => {
    const file = server('a.js', 'a.localhost');
    const previous = loadInstances([file, server('b.js', 'b.localhost')], [], createMockLogger());
    fs.rmSync(file);

    const loaded = loadInstances([file, path.join(folder, 'b.js')], previous, createMockLogger());

    expect(loaded.map(({ instance }) => instance.hostname)).toEqual(['b.localhost']);
  });

  it('throws for a broken file, without starting anything', () => {
    const file = server('a.js', 'a.localhost');
    const previous = loadInstances([file, server('b.js', 'b.localhost')], [], createMockLogger());
    write('b.js', 'module.exports = {');
    server('a.js', 'c.localhost');

    expect(() => loadInstances([file, path.join(folder, 'b.js')], previous, createMockLogger())).toThrow('Unexpected');
    expect(createInstanceHandler).toHaveBeenCalledTimes(2);
  });

  it('throws for a file that does not export a server', () => {
    expect(() => loadInstances([write('a.js', `module.exports = { hostname: 'a.localhost' };`)], [], createMockLogger())).toThrow('does not export a server');
  });

  it('stops the servers it started when another one fails to start', () => {
    const close = jest.fn();
    jest
      .mocked(createInstanceHandler)
      .mockReturnValueOnce({ handler: jest.fn(), close })
      .mockImplementationOnce(() => {
        throw new Error('options are required');
      });

    expect(() => loadInstances([server('a.js', 'a.localhost'), server('b.js', 'b.localhost')], [], createMockLogger())).toThrow('options are required');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reads the certificates again for the servers that are kept, and starts nothing when one cannot be read', () => {
    const key = write('key.pem', 'key');
    const cert = write('cert.pem', 'one');
    const file = write('a.js', `module.exports = { hostname: 'a.localhost', protocol: 'https', key: ${JSON.stringify(key)}, cert: ${JSON.stringify(cert)} };`);
    const emptyContext = tls.createSecureContext();
    const createSecureContext = jest.spyOn(tls, 'createSecureContext').mockReturnValue(emptyContext);
    const previous = loadInstances([file], [], createMockLogger());
    write('cert.pem', 'two');

    const loaded = loadInstances([file], previous, createMockLogger());
    fs.rmSync(cert);

    expect(loaded[0]).toBe(previous[0]);
    expect(createSecureContext).toHaveBeenLastCalledWith(expect.objectContaining({ cert: 'two' }));
    expect(() => loadInstances([file], loaded, createMockLogger())).toThrow('cert is not a file');
    expect(createInstanceHandler).toHaveBeenCalledTimes(1);
  });

  it('throws with the problems of all the servers before it starts any, and logs the warnings of the ones that start', () => {
    const logger = createMockLogger();
    const valid: ServerConfig = { hostname: 'a.localhost', protocol: 'http' };

    expect(() =>
      loadInstances([valid, { ...valid, hostname: 'b.localhost', typo: 1 }, { ...valid, hostname: 'c.localhost', typo: 1 }] as ServerConfig[], [], logger)
    ).toThrow(/typo is not a setting\nerror: http:\/\/c.localhost typo is not a setting/);
    expect(createInstanceHandler).not.toHaveBeenCalled();

    loadInstances([valid], [], logger, { configuration: { statsDomain: 'a.localhost' } });
    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('statsDomain'));
  });
});
