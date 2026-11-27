import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getServiceScriptPath from './get-service-script-path';

describe('getServiceScriptPath', () => {
  let folder: string;
  let script: string;

  beforeAll(() => {
    folder = realpathSync(mkdtempSync(join(tmpdir(), 'service-script-')));
    mkdirSync(join(folder, 'releases'));
    script = join(folder, 'releases', 'cli.js');
    writeFileSync(script, '');
    writeFileSync(join(folder, 'other.js'), '');
    symlinkSync(join(folder, 'releases'), join(folder, 'current'), 'junction');
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('is the path the command was run by, with its links, which an update points elsewhere', () => {
    expect(getServiceScriptPath(join(folder, 'current', 'cli.js'), script)).toBe(join(folder, 'current', 'cli.js'));
  });

  it.each([
    ['another script', 'other.js'],
    ['nothing that is there', 'missing.js'],
  ])('is the script of the installation when the command was run by %s', (_, name) => {
    expect(getServiceScriptPath(join(folder, name), script)).toBe(script);
  });

  it('goes through the link to the package for the store of pnpm, which the shims of its commands run', () => {
    const stored = join(folder, 'node_modules', '.pnpm', 'cli@1.0.0', 'node_modules', 'cli');
    mkdirSync(stored, { recursive: true });
    writeFileSync(join(stored, 'cli.js'), '');
    symlinkSync(stored, join(folder, 'node_modules', 'cli'), 'junction');

    expect(getServiceScriptPath(join(stored, 'cli.js'), join(stored, 'cli.js'))).toBe(join(folder, 'node_modules', 'cli', 'cli.js'));
  });

  it('is the script of the installation without a path it was run by', () => {
    expect(getServiceScriptPath(undefined, script)).toBe(script);
  });
});
