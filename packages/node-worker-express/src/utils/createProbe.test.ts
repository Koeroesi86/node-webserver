import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import createProbe from './createProbe';

describe('createProbe', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'probe-'));
    await fs.writeFile(path.join(root, 'file.txt'), 'content');
  });

  afterAll(() => fs.rm(root, { recursive: true, force: true }));

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('tells whether a path exists, and its stats', async () => {
    const probe = createProbe();

    expect(await probe.exists(path.join(root, 'file.txt'))).toBe(true);
    expect(await probe.exists(path.join(root, 'missing.txt'))).toBe(false);
    expect((await probe.stat(path.join(root, 'file.txt')))?.isFile()).toBe(true);
    expect(await probe.stat(path.join(root, 'missing.txt'))).toBeUndefined();
  });

  it('asks the file system once for the same path, the answer "no" included', async () => {
    const access = jest.spyOn(fs, 'access');
    const probe = createProbe();

    await probe.exists(path.join(root, 'missing.txt'));
    await probe.exists(path.join(root, 'missing.txt'));
    await probe.exists(path.join(root, 'file.txt'));
    await probe.exists(path.join(root, 'file.txt'));

    expect(access).toHaveBeenCalledTimes(2);
  });

  it('asks once when requests ask at the same time', async () => {
    const stat = jest.spyOn(fs, 'stat');
    const probe = createProbe();

    await Promise.all(Array.from({ length: 50 }, () => probe.stat(path.join(root, 'file.txt'))));

    expect(stat).toHaveBeenCalledTimes(1);
  });

  it('asks again when the answer is older than the time to live', async () => {
    jest.useFakeTimers({ now: 1000000, doNotFake: ['setImmediate', 'nextTick'] });
    const access = jest.spyOn(fs, 'access');
    const probe = createProbe(1000);

    await probe.exists(path.join(root, 'file.txt'));
    jest.advanceTimersByTime(1000);
    await probe.exists(path.join(root, 'file.txt'));

    expect(access).toHaveBeenCalledTimes(2);
  });

  it('notices a file that appears once the answer expired', async () => {
    jest.useFakeTimers({ now: 1000000, doNotFake: ['setImmediate', 'nextTick'] });
    const probe = createProbe(1000);
    const later = path.join(root, 'later.txt');

    expect(await probe.exists(later)).toBe(false);
    await fs.writeFile(later, '');
    expect(await probe.exists(later)).toBe(false);
    jest.advanceTimersByTime(1000);

    expect(await probe.exists(later)).toBe(true);
  });

  it('does not share answers between probes', async () => {
    const access = jest.spyOn(fs, 'access');

    await createProbe().exists(path.join(root, 'file.txt'));
    await createProbe().exists(path.join(root, 'file.txt'));

    expect(access).toHaveBeenCalledTimes(2);
  });
});
