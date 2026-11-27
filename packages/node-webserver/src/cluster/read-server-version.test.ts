import fs from 'fs';
import os from 'os';
import path from 'path';
import readServerVersion from './read-server-version';

describe('readServerVersion', () => {
  let root: string;

  const depends: Record<string, string[]> = {
    'node-webserver-cli': ['node-webserver'],
    'node-webserver': ['node-lambda-invoke', 'node-worker-express'],
    'node-worker-express': ['node-worker'],
    'node-lambda-invoke': ['node-worker'],
  };

  /** a release in a folder of its own: the command line with the server it depends on, and the packages that one runs on */
  const release = (name: string, versions: Record<string, string>) => {
    const modules = path.join(root, name, 'node_modules', '@koeroesi86');
    Object.entries(versions).forEach(([short, version]) => {
      const folder = path.join(modules, short);
      const dependencies = Object.fromEntries([...(depends[short] ?? []).map((other) => [`@koeroesi86/${other}`, '*']), ['express', '*']]);
      fs.mkdirSync(path.join(folder, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: `@koeroesi86/${short}`, version, dependencies }));
    });
    const script = path.join(modules, 'node-webserver-cli', 'dist', 'cli.js');
    if (versions['node-webserver-cli']) fs.writeFileSync(script, '');

    return script;
  };
  const all = { 'node-webserver-cli': '1', 'node-webserver': '2', 'node-worker': '3', 'node-worker-express': '4', 'node-lambda-invoke': '5' };

  beforeEach(() => (root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'version-')))));
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('names every package of the server with its version, as they are on the disk', () => {
    const script = release('one', all);
    const first = readServerVersion(script);

    release('one', { 'node-worker': '3.1' });

    expect(first.split(' ')).toEqual(
      ['node-webserver-cli@1', 'node-webserver@2', 'node-lambda-invoke@5', 'node-worker@3', 'node-worker-express@4'].map((entry) => `@koeroesi86/${entry}`)
    );
    expect(readServerVersion(script)).toContain('@koeroesi86/node-worker@3.1');
  });

  it('says what is there where a link on the way to the script points now', () => {
    release('one', all);
    release('two', { ...all, 'node-webserver': '2.1' });
    const current = path.join(root, 'current');
    fs.symlinkSync(path.join(root, 'one'), current, 'junction');
    const script = path.join(current, 'node_modules', '@koeroesi86', 'node-webserver-cli', 'dist', 'cli.js');
    const first = readServerVersion(script);

    fs.unlinkSync(current);
    fs.symlinkSync(path.join(root, 'two'), current, 'junction');

    expect([first, readServerVersion(script)]).toEqual([expect.stringContaining('node-webserver@2 '), expect.stringContaining('node-webserver@2.1 ')]);
  });

  it('names a package that it does not find on the disk as missing, until it is there', () => {
    const { 'node-worker': _, ...without } = all;
    const script = release('one', without);
    expect(readServerVersion(script).split(' ')).toContain('@koeroesi86/node-worker@missing');

    release('one', { 'node-worker': '3' });

    expect(readServerVersion(script).split(' ')).toContain('@koeroesi86/node-worker@3');
  });

  it('cannot be read while a package is half written', () => {
    const script = release('one', all);
    fs.writeFileSync(path.join(root, 'one', 'node_modules', '@koeroesi86', 'node-worker', 'package.json'), '{');
    expect(() => readServerVersion(script)).toThrow();
  });

  it('leaves out the package of a script of someone else, and takes this server for a script that cannot find one', () => {
    const script = path.join(root, 'app.js');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', version: '9' }));
    fs.writeFileSync(script, '');

    expect(readServerVersion(script)).toMatch(/^@koeroesi86\/node-webserver@[^ ]+ @koeroesi86\/node-lambda-invoke@[^ ]+ @koeroesi86\/node-worker@/);
  });
});
