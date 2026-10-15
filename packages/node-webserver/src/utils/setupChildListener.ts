import type { ChildProcess } from 'child_process';
import getDate from './getDate';
import type { Logger } from '../types';

/** how to take the listeners off a child again, so that setting it up twice does not log a line twice */
const detachers = new WeakMap<ChildProcess, () => void>();

const setupChildListener = (child: ChildProcess, logger: Logger) => {
  detachers.get(child)?.();

  const outputListener = (data: Buffer | string) => logger.info(`[${getDate()}] ${data.toString().trim()}`);
  const errorListener = (data: Buffer | string) => logger.error(`[${getDate()}] ${data.toString().trim()}`);
  const closeListener = (code: number | null) => {
    if (code) {
      logger.error(`[${getDate()}] child process exited with code ${code}`);
    }
  };

  child.stdout?.on('data', outputListener);
  child.stderr?.on('data', errorListener);
  child.on('close', closeListener);

  detachers.set(child, () => {
    child.stdout?.off('data', outputListener);
    child.stderr?.off('data', errorListener);
    child.off('close', closeListener);
  });
};

export default setupChildListener;
