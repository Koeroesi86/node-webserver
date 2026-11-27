import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import getConfigurationFiles from './get-configuration-files';

describe('getConfigurationFiles', () => {
  let folder: string;

  beforeAll(() => {
    folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'configuration-files-')));
    fs.writeFileSync(path.join(folder, 'configuration.js'), "require('./ports'); module.exports = {};");
    fs.writeFileSync(path.join(folder, 'ports.js'), 'module.exports = 80;');
  });

  afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

  it('is the file and the ones it loaded', () => {
    const file = path.join(folder, 'configuration.js');
    // the require of node, which a test has to ask for
    const load = createRequire(file);
    const cache = { ...load.cache };
    load(file);

    expect(getConfigurationFiles(file)).toEqual([file, path.join(folder, 'ports.js')]);
    Object.keys(load.cache)
      .filter((loaded) => !cache[loaded])
      .forEach((loaded) => delete load.cache[loaded]);
  });

  it.each([['ports.js'], ['missing.js']])('is the file alone when it was not loaded: %s', (name) => {
    expect(getConfigurationFiles(path.join(folder, name))).toEqual([path.join(folder, name)]);
  });
});
