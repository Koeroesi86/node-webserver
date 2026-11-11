import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import watchFiles from './watch-files';

describe('watchFiles', () => {
  let folder: string;
  let stop = () => {};

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-files-'));
  });

  afterEach(() => {
    stop();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  /** resolves with the first change */
  const watch = (files: string[]) =>
    new Promise<void>((resolve) => {
      stop = watchFiles(files, resolve);
    });

  it('tells about a file that is written', async () => {
    const file = path.join(folder, 'a.js');
    fs.writeFileSync(file, 'one');
    const changed = watch([file]);

    fs.writeFileSync(file, 'two');

    await changed;
  });

  it('tells about a file that is replaced, as editors save', async () => {
    const file = path.join(folder, 'a.js');
    fs.writeFileSync(file, 'one');
    const changed = watch([file]);

    fs.writeFileSync(`${file}.tmp`, 'two');
    fs.renameSync(`${file}.tmp`, file);

    await changed;
  });

  it('tells about a file that is created', async () => {
    const file = path.join(folder, 'a.js');
    const changed = watch([file]);

    fs.writeFileSync(file, 'one');

    await changed;
  });

  it('does not tell about the other files of the folder', async () => {
    const file = path.join(folder, 'a.js');
    const onChange = jest.fn();
    stop = watchFiles([file], onChange);
    // a second watcher of the same folder tells when the write has been seen
    const seen = new Promise<void>((resolve) => {
      const watcher = fs.watch(folder, () => {
        watcher.close();
        resolve();
      });
    });

    fs.writeFileSync(path.join(folder, 'b.js'), 'one');
    await seen;
    // the watchers of a folder are told in the same turn
    await new Promise((resolve) => setImmediate(resolve));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('tells about a file of a folder that is given by its real path and through a link', async () => {
    const link = path.join(folder, 'link');
    const real = path.join(folder, 'real');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link, 'dir');
    const file = path.join(real, 'a.js');
    fs.writeFileSync(file, 'one');
    const changed = watch([file, path.join(link, 'b.js')]);

    fs.writeFileSync(file, 'two');

    await changed;
  });

  it('tells about a link that is made to point to another folder, as a deploy does', async () => {
    ['one', 'two'].forEach((release) => {
      fs.mkdirSync(path.join(folder, release));
      fs.writeFileSync(path.join(folder, release, 'a.js'), release);
    });
    const link = path.join(folder, 'build');
    fs.symlinkSync(path.join(folder, 'one'), link, 'dir');
    const changed = watch([path.join(link, 'a.js')]);

    fs.symlinkSync(path.join(folder, 'two'), `${link}.next`, 'junction');
    // windows cannot rename a link over another, a deploy there removes the old one first
    if (process.platform === 'win32') {
      fs.rmSync(link);
    }
    fs.renameSync(`${link}.next`, link);

    await changed;
  });

  it('does not tell about the other files next to a link', () => {
    // the listener is called by hand: the events of the system differ in which names they carry, and a late one for the link itself would count as a sibling
    const listeners: ((event: string, name: string) => void)[] = [];
    const watch = jest.spyOn(fs, 'watch').mockImplementation((...args: unknown[]) => {
      listeners.push(args.filter((arg): arg is (event: string, name: string) => void => typeof arg === 'function')[0]);
      return Object.assign(new EventEmitter(), { close: jest.fn() }) as unknown as fs.FSWatcher;
    });
    fs.mkdirSync(path.join(folder, 'one'));
    const link = path.join(folder, 'build');
    fs.symlinkSync(path.join(folder, 'one'), link, 'junction');
    const onChange = jest.fn();
    stop = watchFiles([path.join(link, 'a.js')], onChange);

    listeners.forEach((listener) => listener('rename', '.deploy.lock'));
    expect(onChange).not.toHaveBeenCalled();

    listeners.forEach((listener) => listener('rename', 'build'));
    expect(onChange).toHaveBeenCalledTimes(1);
    watch.mockRestore();
  });

  it('ignores a folder that does not exist', () => {
    expect(() => watchFiles([path.join(folder, 'missing', 'a.js')], jest.fn())()).not.toThrow();
  });
});
