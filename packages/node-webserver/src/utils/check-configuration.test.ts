import fs from 'fs';
import os from 'os';
import path from 'path';
import exampleConfiguration from '../configuration.example';
import checkConfiguration from './check-configuration';
import { createInstanceHandler } from '../server';

// the check must not start anything, which the real handler would do for every type
jest.mock('../server/create-instance-handler', () => ({ __esModule: true, default: jest.fn() }));

describe('checkConfiguration', () => {
  let folder: string;

  beforeEach(() => {
    // the real path, which is the one a file reports when its folder is behind a link (the temporary folder of macOS)
    folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'check-configuration-')));
    jest.resetModules();
  });

  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

  const write = (name: string, content: string) => {
    const file = path.join(folder, name);
    fs.writeFileSync(file, content);
    return file;
  };
  const find = (configuration: object) =>
    checkConfiguration(configuration).map(({ severity, server, setting, message }) => `${severity} ${server} ${setting} ${message}`);

  it('finds nothing in a configuration that is valid, and starts nothing', () => {
    const file = write('a.js', `module.exports = { hostname: 'a.localhost', protocol: 'http', type: 'worker', options: { root: ${JSON.stringify(folder)} } };`);

    expect(checkConfiguration({ ...exampleConfiguration, servers: [file, ...exampleConfiguration.servers] })).toEqual([]);
    expect(createInstanceHandler).not.toHaveBeenCalled();
  });

  it('finds the problems of the configuration and of the servers of the files together', () => {
    const file = write('a.js', `module.exports = { hostname: 'a.localhost', protocol: 'http', proxyOption: {} };`);

    expect(find({ portHttp: 8080, portHttps: 8080, servers: [file] })).toEqual([
      'error undefined portHttps listens on the port of portHttp too: 8080',
      `error http://a.localhost (${file}) proxyOption is not a setting`,
    ]);
  });

  it('names a file that fails to load, one that is not a server and one that is not there, and checks the rest', () => {
    const broken = write('broken.js', 'throw new Error("boom");');
    const notServer = write('not-server.js', 'module.exports = {};');
    const missing = path.join(folder, 'missing.js');
    const valid = write('valid.js', `module.exports = { hostname: 'a.localhost', protocol: 'http', typo: 1 };`);

    expect(find({ servers: [broken, notServer, missing, valid] })).toEqual([
      `error ${broken} (file) could not be loaded: boom`,
      `error ${notServer} (file) could not be loaded: ${notServer} does not export a server with a hostname and a protocol.`,
      `warning ${missing} (file) does not exist: ${missing}, the server is left out`,
      `error http://a.localhost (${valid}) typo is not a setting`,
    ]);
  });

  it('checks servers that are not in a list as a mistake of the configuration, not a crash', () => {
    expect(find({ servers: 'a.js' })).toEqual(['error undefined servers must be array']);
  });
});
