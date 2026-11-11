import { readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LAMBDA_FOLDER_PREFIX } from '../constants';

const processExists = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // a process of another user exists, it is just not ours to signal
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM';
  }
};

/** removes the folders of lambdas that a server left behind when it was killed, never the ones of a server that is still running */
const sweepLambdaFolders = (folder = tmpdir()) => {
  const pattern = new RegExp(`^${LAMBDA_FOLDER_PREFIX}(\\d+)-`);

  readdirSync(folder)
    .map((name) => ({ name, pid: Number(pattern.exec(name)?.[1]) }))
    .filter(({ pid }) => pid > 0 && pid !== process.pid && !processExists(pid))
    .forEach(({ name }) => rmSync(join(folder, name), { recursive: true, force: true }));
};

export default sweepLambdaFolders;
