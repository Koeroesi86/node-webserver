import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import resolveConfigurationPath from './resolve-configuration-path';

describe('resolveConfigurationPath', () => {
  let folder: string;
  let file: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'resolve-configuration-'));
    file = join(folder, 'configuration.js');
    writeFileSync(file, 'module.exports = {};');
  });

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('prefers the argument to the environment', () => {
    expect(resolveConfigurationPath(file, join(folder, 'other.js'))).toBe(file);
  });

  it('takes the environment without an argument', () => {
    expect(resolveConfigurationPath(undefined, file)).toBe(file);
  });

  it('throws without either, instead of starting an example server', () => {
    expect(() => resolveConfigurationPath(undefined, undefined)).toThrow('--configuration');
  });

  it('throws when the file is missing', () => {
    expect(() => resolveConfigurationPath(join(folder, 'missing.js'), undefined)).toThrow('does not exist');
  });

  it('uses the fallback for the development script, even before the file exists', () => {
    const missing = join(folder, 'missing.js');

    expect(resolveConfigurationPath(undefined, undefined, missing)).toBe(missing);
  });
});
