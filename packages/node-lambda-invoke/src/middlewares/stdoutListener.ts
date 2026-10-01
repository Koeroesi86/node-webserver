import moment from 'moment';
import type Lambda from '../classes/Lambda';
import type { Logger } from '../types';

const getDate = () => moment().format('YYYY-MM-DD HH:mm:ss.SS');

const stdoutListener = (lambdaInstance: Lambda, logger: Logger = () => {}) => {
  const messageListener = (data: Buffer | string) => {
    logger(`[${getDate()}] ${data.toString().trim()}`);
  };
  if (lambdaInstance.stdout) {
    lambdaInstance.stdout.off('data', messageListener);
    lambdaInstance.stdout.on('data', messageListener);
  }
  if (lambdaInstance.stderr) {
    lambdaInstance.stderr.off('data', messageListener);
    lambdaInstance.stderr.on('data', messageListener);
  }

  const closeListener = (code: number | null) => {
    if (code) logger(`[${getDate()}] child process exited with code ${code}`);
  };
  lambdaInstance.addEventListenerOnce('close', closeListener);
};

export default stdoutListener;
