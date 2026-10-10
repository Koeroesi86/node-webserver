import { existsSync } from 'fs';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sweepLambdaFolders from './sweep-lambda-folders';

/** a process id that no process has: the highest one linux allows is 4194304 */
const deadPid = 2 ** 22 + 1000;

describe('sweepLambdaFolders', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'sweep-'));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('removes the folders of a server that is gone, and nothing else', async () => {
    const left = join(folder, `node-lambda-${deadPid}-abc123`);
    const running = join(folder, `node-lambda-${process.pid}-abc123`);
    const parent = join(folder, `node-lambda-${process.ppid}-abc123`);
    const other = join(folder, 'something-else');
    await Promise.all([left, running, parent, other].map((path) => mkdir(join(path, 'tmp'), { recursive: true })));

    sweepLambdaFolders(folder);

    expect([left, running, parent, other].map((path) => existsSync(path))).toEqual([false, true, true, true]);
  });
});
