import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import createWatchedProbe from './create-watched-probe';
import { uncachedProbe } from './create-probe';
import type { Probe } from './create-probe';

describe('createWatchedProbe', () => {
  let root: string;
  let directory: string;
  let counter = 0;

  const countingBase = () => {
    const exists = jest.fn(uncachedProbe.exists);
    const stat = jest.fn(uncachedProbe.stat);
    const base: Probe = { exists, stat };
    return { base, exists, stat };
  };

  /** the listing is read in the background after the first miss, a path that is asked for until it answers without the probe below */
  const untilListed = async (probe: Probe, exists: jest.Mock, listedDirectory = directory) => {
    const missing = path.join(listedDirectory, 'listed-check');
    let asked = exists.mock.calls.length;
    await probe.exists(missing);
    while (exists.mock.calls.length > asked) {
      asked = exists.mock.calls.length;
      await new Promise((resolve) => setImmediate(resolve));
      await probe.exists(missing);
    }
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'watched-probe-'));
  });

  beforeEach(async () => {
    directory = path.join(root, `dir-${counter++}`);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'file.txt'), 'content');
  });

  afterAll(() => fs.rm(root, { recursive: true, force: true }));

  it('answers like the probe below, for paths that are there and for paths that are not', async () => {
    const probe = createWatchedProbe(uncachedProbe);

    expect(await probe.exists(path.join(directory, 'file.txt'))).toBe(true);
    expect(await probe.exists(path.join(directory, 'missing.txt'))).toBe(false);
    expect((await probe.stat(path.join(directory, 'file.txt')))?.isFile()).toBe(true);
    expect(await probe.stat(path.join(directory, 'missing.txt'))).toBeUndefined();
    probe.close();
  });

  it('answers a path that was never asked for before from the listing, once a miss in the directory has been seen', async () => {
    const { base, exists, stat } = countingBase();
    const probe = createWatchedProbe(base);

    await probe.exists(path.join(directory, 'first-missing.txt'));
    await untilListed(probe, exists);
    exists.mockClear();

    expect(await probe.exists(path.join(directory, 'second-missing.txt'))).toBe(false);
    expect(await probe.stat(path.join(directory, 'third-missing.txt'))).toBeUndefined();
    expect(exists).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    probe.close();
  });

  it('asks the probe below about a name that is listed, which knows about permissions', async () => {
    const { base, exists } = countingBase();
    const probe = createWatchedProbe(base);
    await probe.exists(path.join(directory, 'missing.txt'));
    await untilListed(probe, exists);
    exists.mockClear();

    expect(await probe.exists(path.join(directory, 'file.txt'))).toBe(true);
    expect(exists).toHaveBeenCalledTimes(1);
    probe.close();
  });

  it('does not answer "missing" for a name that differs only in case from a listed one', async () => {
    const { base, exists } = countingBase();
    const probe = createWatchedProbe(base);
    await probe.exists(path.join(directory, 'missing.txt'));
    await untilListed(probe, exists);
    exists.mockClear();

    await probe.exists(path.join(directory, 'FILE.TXT'));

    expect(exists).toHaveBeenCalledTimes(1);
    probe.close();
  });

  it('finds a file that is added after the directory was listed', async () => {
    const { base, exists } = countingBase();
    const probe = createWatchedProbe(base);
    await probe.exists(path.join(directory, 'added.txt'));
    await untilListed(probe, exists);

    await fs.writeFile(path.join(directory, 'added.txt'), 'new');

    // the event of the watcher drops the listing, the answer is the one of the probe below as soon as it has arrived
    let found = await probe.exists(path.join(directory, 'added.txt'));
    while (!found) {
      await new Promise((resolve) => setImmediate(resolve));
      found = await probe.exists(path.join(directory, 'added.txt'));
    }
    expect(found).toBe(true);
    probe.close();
  });

  it('asks the probe below again once a listing is older than its maximum age, whatever the watcher reported', async () => {
    const { base, exists } = countingBase();
    const probe = createWatchedProbe(base, { maxAge: 1000 });
    await probe.exists(path.join(directory, 'missing.txt'));
    await untilListed(probe, exists);
    exists.mockClear();

    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 1500);
    await probe.exists(path.join(directory, 'other-missing.txt'));
    clock.mockRestore();

    expect(exists).toHaveBeenCalledTimes(1);
    probe.close();
  });

  it('does not list a directory with more entries than allowed', async () => {
    const { base, exists } = countingBase();
    const probe = createWatchedProbe(base, { maxEntries: 0 });

    await probe.exists(path.join(directory, 'missing.txt'));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    exists.mockClear();
    await probe.exists(path.join(directory, 'other-missing.txt'));

    expect(exists).toHaveBeenCalledTimes(1);
    probe.close();
  });

  it('lists no other directory while the limit is reached, and does when a listing has expired', async () => {
    const { base, exists } = countingBase();
    const first = path.join(root, 'limit-first');
    const second = path.join(root, 'limit-second');
    await fs.mkdir(first);
    await fs.mkdir(second);
    const probe = createWatchedProbe(base, { maxDirectories: 1 });
    await probe.exists(path.join(first, 'missing.txt'));
    await untilListed(probe, exists, first);

    await probe.exists(path.join(second, 'missing.txt'));
    await probe.exists(path.join(second, 'other-missing.txt'));
    await new Promise((resolve) => setImmediate(resolve));
    exists.mockClear();
    await probe.exists(path.join(second, 'third-missing.txt'));
    expect(exists).toHaveBeenCalledTimes(1);

    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500);
    await probe.exists(path.join(second, 'fourth-missing.txt'));
    await untilListed(probe, exists, second);
    clock.mockRestore();
    probe.close();
  });

  it('lists a directory only when a second path in it is missing', async () => {
    const { base, exists } = countingBase();
    const probe = createWatchedProbe(base);

    await probe.exists(path.join(directory, 'first-missing.txt'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(probe.stats().directories).toBe(0);
    await probe.exists(path.join(directory, 'second-missing.txt'));
    expect(probe.stats().directories).toBe(1);
    expect(exists).toHaveBeenCalledTimes(2);
    probe.close();
  });

  it('holds no more names than allowed together, a directory that does not fit is not listed', async () => {
    const { base, exists } = countingBase();
    const directories = await Promise.all(
      ['budget-a', 'budget-b', 'budget-c'].map(async (name) => {
        const budgeted = path.join(root, name);
        await fs.mkdir(budgeted);
        await Promise.all(['1', '2', '3'].map((file) => fs.writeFile(path.join(budgeted, file), '')));
        return budgeted;
      })
    );
    const probe = createWatchedProbe(base, { maxTotalEntries: 7 });

    await untilListed(probe, exists, directories[0]);
    await untilListed(probe, exists, directories[1]);
    // the third does not fit, its watcher is closed again once it has been read
    await probe.exists(path.join(directories[2], 'missing.txt'));
    await probe.exists(path.join(directories[2], 'other-missing.txt'));
    while (probe.stats().directories > 2) await new Promise((resolve) => setImmediate(resolve));

    expect(probe.stats()).toEqual({ directories: 2, listings: 2, entries: 6 });
    probe.close();
    expect(probe.stats()).toEqual({ directories: 0, listings: 0, entries: 0 });
  });

  it('does not list more directories than allowed however many are scanned', async () => {
    const probe = createWatchedProbe(uncachedProbe, { maxDirectories: 3 });
    const scanned = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const scannedDirectory = path.join(root, `scan-${index}`);
        await fs.mkdir(scannedDirectory);
        return scannedDirectory;
      })
    );

    for (const scannedDirectory of scanned) {
      await probe.exists(path.join(scannedDirectory, 'missing.txt'));
      await probe.exists(path.join(scannedDirectory, 'other-missing.txt'));
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(probe.stats().directories).toBeLessThanOrEqual(3);
    probe.close();
  });

  it('is only the probe below with no directories allowed', async () => {
    const { base, exists } = countingBase();
    const probe = createWatchedProbe(base, { maxDirectories: 0 });

    await probe.exists(path.join(directory, 'missing.txt'));
    await new Promise((resolve) => setImmediate(resolve));
    await probe.exists(path.join(directory, 'other-missing.txt'));

    expect(exists).toHaveBeenCalledTimes(2);
    expect(probe.stats().directories).toBe(0);
  });

  it('keeps using the probe below for a directory that cannot be watched', async () => {
    const { base, exists } = countingBase();
    const probe = createWatchedProbe(base);

    await probe.exists(path.join(root, 'not-a-directory', 'missing.txt'));
    await probe.exists(path.join(root, 'not-a-directory', 'other-missing.txt'));

    expect(exists).toHaveBeenCalledTimes(2);
    probe.close();
  });

  it('starts no watcher after it was closed', async () => {
    const { base, exists } = countingBase();
    const probe = createWatchedProbe(base);
    probe.close();

    await probe.exists(path.join(directory, 'missing.txt'));
    await new Promise((resolve) => setImmediate(resolve));
    await probe.exists(path.join(directory, 'other-missing.txt'));

    expect(exists).toHaveBeenCalledTimes(2);
  });
});
