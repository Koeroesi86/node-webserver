import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { uncachedProbe } from './create-probe';
import warmPaths from './warm-paths';

describe('warmPaths', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'warm-paths-'));
    await fs.writeFile(path.join(root, 'worker.js'), '');
    await fs.mkdir(path.join(root, 'plain'));
    await fs.writeFile(path.join(root, 'plain', 'file.txt'), '');
  });

  afterAll(() => fs.rm(root, { recursive: true, force: true }));

  const warm = (paths: string[], keepWarm = jest.fn(), countFor = () => 2) =>
    warmPaths({ paths, rootPath: root, index: ['worker.js'], probe: uncachedProbe, countFor, keepWarm }).then(() => keepWarm);

  it('keeps the worker file of a path warm as often as asked for', async () => {
    const keepWarm = await warm(['/some/page']);

    expect(keepWarm).toHaveBeenCalledWith(path.join(root, 'worker.js'), 2);
  });

  it('asks for the count of the worker file', async () => {
    const countFor = jest.fn(() => 3);

    await warm(['/'], jest.fn(), countFor);

    expect(countFor).toHaveBeenCalledWith(path.join(root, 'worker.js'));
  });

  it('leaves out a path that the static worker serves', async () => {
    const keepWarm = await warm(['/plain/file.txt']);

    expect(keepWarm).not.toHaveBeenCalled();
  });

  it('goes on with the other paths when one cannot be looked up', async () => {
    const keepWarm = jest.fn().mockImplementationOnce(() => {
      throw new Error('broken');
    });

    await warm(['/', '/again'], keepWarm);

    expect(keepWarm).toHaveBeenCalledTimes(2);
  });
});
