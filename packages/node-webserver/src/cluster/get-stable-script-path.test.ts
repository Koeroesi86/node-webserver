import fs from 'fs';
import os from 'os';
import path from 'path';
import getStableScriptPath from './get-stable-script-path';

describe('getStableScriptPath', () => {
  let root: string;
  const modules = () => path.join(root, 'node_modules');
  /** a package in the store as pnpm lays it out, the version in the name of its folder */
  const stored = (name: string, version: string) => {
    const folder = path.join(modules(), '.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules', name);
    fs.mkdirSync(path.join(folder, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'dist', 'cli.js'), '');
    return folder;
  };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stable-')));
    fs.mkdirSync(path.join(modules(), '@scope'), { recursive: true });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('goes through the link to the package that the project has, for a file in the store', () => {
    const folder = stored('@scope/cli', '1.0.0');
    fs.symlinkSync(folder, path.join(modules(), '@scope', 'cli'), 'junction');

    expect(getStableScriptPath(path.join(folder, 'dist', 'cli.js'))).toBe(path.join(modules(), '@scope', 'cli', 'dist', 'cli.js'));
  });

  it('leaves a file whose link leads to another version, or has no link', () => {
    const [old, current] = [stored('@scope/cli', '1.0.0'), stored('@scope/cli', '2.0.0')];
    const script = path.join(old, 'dist', 'cli.js');
    expect(getStableScriptPath(script)).toBe(script);

    fs.symlinkSync(current, path.join(modules(), '@scope', 'cli'), 'junction');

    expect(getStableScriptPath(script)).toBe(script);
  });

  it('leaves any other path as it is', () => {
    const script = path.join(modules(), '@scope', 'cli', 'dist', 'cli.js');

    expect(getStableScriptPath(script)).toBe(script);
  });
});
