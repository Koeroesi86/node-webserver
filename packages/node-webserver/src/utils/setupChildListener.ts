import type { ChildProcess } from 'child_process';
import getDate from './getDate';
import logger from './logger';

const parseMessage = (data: Buffer | string) => logger.info(`[${getDate()}] ${data.toString().trim()}`);

const setupChildListener = (child: ChildProcess) => {
  if (child.stdout) {
    child.stdout.off('data', parseMessage);
    child.stdout.on('data', parseMessage);
  }

  const errorListener = (data: Buffer | string) => {
    logger.error(`[${getDate()}] ${data.toString().trim()}`);
  };
  if (child.stderr) {
    child.stderr.off('data', errorListener);
    child.stderr.on('data', errorListener);
  }

  const closeListener = (code: number | null) => {
    if (code) {
      logger.error(`[${getDate()}] child process exited with code ${code}`);
    }
  };
  child.off('close', closeListener);
  child.on('close', closeListener);
};

export default setupChildListener;
