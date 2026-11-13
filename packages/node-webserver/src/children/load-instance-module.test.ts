import fs from 'fs';
import os from 'os';
import path from 'path';
import loadInstanceModule from './load-instance-module';

const writeRelease = (folder: string, hostname: string) => {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'server-config.js'), `module.exports = { hostname: '${hostname}', protocol: 'http' };`);
};

describe('loadInstanceModule', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'load-instance-module-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns undefined when the file does not exist', () => {
    expect(loadInstanceModule(path.join(root, 'missing.js'))).toBeUndefined();
  });

  it('loads the release a link points to every time the link is switched', () => {
    const link = path.join(root, 'build');
    ['one', 'two', 'three'].forEach((name) => writeRelease(path.join(root, `build.${name}`), `${name}.example.com`));

    const hostnames = ['one', 'two', 'three'].map((name) => {
      fs.rmSync(link, { force: true });
      fs.symlinkSync(`build.${name}`, link);
      return loadInstanceModule(path.join(link, 'server-config.js'))?.instance.hostname;
    });

    expect(hostnames).toEqual(['one.example.com', 'two.example.com', 'three.example.com']);
  });

  it('loads the new release once the previous one is removed', () => {
    const link = path.join(root, 'build');
    writeRelease(path.join(root, 'build.one'), 'one.example.com');
    writeRelease(path.join(root, 'build.two'), 'two.example.com');
    fs.symlinkSync('build.one', link);
    loadInstanceModule(path.join(link, 'server-config.js'));

    fs.rmSync(link);
    fs.symlinkSync('build.two', link);
    fs.rmSync(path.join(root, 'build.one'), { recursive: true });

    expect(loadInstanceModule(path.join(link, 'server-config.js'))?.instance.hostname).toBe('two.example.com');
  });
});
