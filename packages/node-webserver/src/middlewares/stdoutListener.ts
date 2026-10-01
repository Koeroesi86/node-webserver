import type { Readable } from 'stream';
import getDate from '../utils/getDate';

interface ListenableWorker {
  stdout?: Readable | null;
  stderr?: Readable | null;
  instance?: unknown;
  addEventListenerOnce: (event: string, listener: (code?: number) => void) => void;
}

let currentLogger: (message: string) => void = () => {};
const messageListener = (data: Buffer | string) => {
  currentLogger(data.toString().trim());
};

const stdoutListener = (childProcess: ListenableWorker, logger: (message: string) => void = () => {}) => {
  currentLogger = logger;

  if (childProcess.stdout && !childProcess.stdout.listeners('data').includes(messageListener)) {
    childProcess.stdout.on('data', messageListener);
  }
  if (childProcess.stderr && !childProcess.stderr.listeners('data').includes(messageListener)) {
    childProcess.stderr.on('data', messageListener);
  }

  const closeListener = (code?: number) => {
    if (code) logger(`[${getDate()}] child process exited with code ${code}`);

    if (childProcess && childProcess.instance) {
      if (childProcess.stdout) childProcess.stdout.off('data', messageListener);
      if (childProcess.stderr) childProcess.stderr.off('data', messageListener);
    }
  };
  childProcess.addEventListenerOnce('close', closeListener);
};

export default stdoutListener;
