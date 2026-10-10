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

  it('ignores a folder that does not exist', () => {
    expect(() => watchFiles([path.join(folder, 'missing', 'a.js')], jest.fn())()).not.toThrow();
  });
});
