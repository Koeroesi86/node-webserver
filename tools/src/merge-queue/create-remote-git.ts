import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RunGit } from '../types/merge-queue';

/** git in the folder, which pushes with the token and commits as the bot. The token only goes into the environment, not into arguments or the config of the repository */
export const createRemoteGit = (rootPath: string, token: string): RunGit => {
  const execute = promisify(execFile);
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    GIT_COMMITTER_NAME: 'github-actions[bot]',
    GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
  };

  return async (...args) => {
    await execute('git', args, { cwd: rootPath, env });
  };
};
