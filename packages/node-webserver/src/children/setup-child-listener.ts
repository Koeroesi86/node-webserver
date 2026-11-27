import type { ChildProcess } from 'child_process';
import type { Readable } from 'stream';
import { createLineSplitter } from '@koeroesi86/node-worker/pool';
import { labelLine } from '../utils';
import type { Logger } from '../types';

/** how to take the listeners off a child again, so that setting it up twice does not log a line twice */
const detachers = new WeakMap<ChildProcess, () => void>();

/** reads an output of a child and logs it line by line. `flush` logs the line that waits for its end, `detach` stops the reading. */
const listenToOutput = (stream: Readable | null | undefined, enabled: boolean, log: (line: string) => void) => {
  const lines = createLineSplitter(log);
  // read also when the level is off, as the child would block on a full pipe, but no lines are built then
  const listener = enabled ? lines.write : () => {};
  stream?.on('data', listener);
  stream?.on('end', lines.end);

  return {
    flush: lines.end,
    detach: () => {
      stream?.off('data', listener);
      stream?.off('end', lines.end);
    },
  };
};

/**
 * Logs what the application of the `child` server of `hostname` writes, and what happens to its process, with the host in front of every line.
 * Returns a function that logs the lines that still wait for their line break, for a process that ends before the output of the application does.
 */
const setupChildListener = (child: ChildProcess, hostname: string, logger: Logger) => {
  detachers.get(child)?.();

  const label = (text: string) => labelLine(hostname, text);
  const output = listenToOutput(child.stdout, logger.isEnabled('info'), (line) => logger.info(label(line)));
  const errors = listenToOutput(child.stderr, logger.isEnabled('error'), (line) => logger.error(label(line)));
  // without a listener it would end the process, and with it the other servers
  const failureListener = (error: Error) => logger.error(label(`${child.spawnfile} could not be started:`), error);
  const closeListener = (code: number | null) => {
    if (code) {
      logger.error(label(`child process exited with code ${code}`));
    }
  };

  child.on('error', failureListener);
  child.on('close', closeListener);

  detachers.set(child, () => {
    output.detach();
    errors.detach();
    child.off('error', failureListener);
    child.off('close', closeListener);
  });

  return () => {
    output.flush();
    errors.flush();
  };
};

export default setupChildListener;
