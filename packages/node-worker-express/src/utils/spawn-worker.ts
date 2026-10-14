import path from 'path';
import { Duplex } from 'stream';
import Worker from '@koeroesi86/node-worker';
import createChannel from './createChannel';
import type { Channel } from './createChannel';
import type { WorkerInputEvent, WorkerOutputEvent } from '../types';

/** the options to spawn a worker with, or a function that makes them: building them can be costly (the environment is copied), and it is only needed when a worker is started */
export type SpawnOptions = object | (() => object);

interface SpawnParams {
  workerPath: string;
  options: SpawnOptions;
  /** receives the messages of all requests of the worker */
  onMessage: (message: WorkerOutputEvent) => void;
  /** receive what the worker writes to its stdout and stderr, attached once when it starts */
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
}

const createWorkerCommand = (workerPath: string) => {
  const ext = path.extname(workerPath);
  switch (ext) {
    case '.js':
    default:
      return `node --expose-gc ${path.resolve(__dirname, '../workerInvoke.js')} ${workerPath}`;
  }
};

/** Starts the process of a worker with its stdio layout, and the channel its messages go through. */
const spawnWorker = ({ workerPath, options, onMessage, onStdout, onStderr }: SpawnParams): { instance: Worker; channel: Channel<WorkerInputEvent> } => {
  // the IPC channel of node is only there for what the socket pair cannot carry: the connections of clients that are handed over.
  // the fourth stdio is the socket pair the messages go through, in place of the IPC channel of node that sends JSON.
  // 'overlapped' is a plain pipe except on Windows, where the worker could not read and write it at the same time otherwise
  const instance = new Worker(createWorkerCommand(workerPath), {
    ...(typeof options === 'function' ? options() : options),
    stdio: ['pipe', 'pipe', 'pipe', 'overlapped', 'ipc'],
  });
  const socket = instance.instance.stdio[3];
  if (!(socket instanceof Duplex)) {
    instance.terminate();
    throw new Error(`The worker ${workerPath} has no channel.`);
  }

  // a single listener dispatches the messages of all requests of the worker
  const channel = createChannel<WorkerOutputEvent, WorkerInputEvent>(socket, onMessage);

  // once for the worker, not for every request it gets, and from the start, so that nothing it writes waits unread in the pipe
  if (onStdout) instance.instance.stdout?.on('data', onStdout);
  if (onStderr) instance.instance.stderr?.on('data', onStderr);

  return { instance, channel };
};

export default spawnWorker;
