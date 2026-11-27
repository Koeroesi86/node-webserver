import { Duplex } from 'stream';
import type { Readable } from 'stream';
import Worker from '../../index';
import { createChannel } from '../channel';
import createLineSplitter from './create-line-splitter';
import type { Channel } from '../channel';
import type { WorkerInputEvent, WorkerOutputEvent } from '../types';

export type WorkerOptions = ConstructorParameters<typeof Worker>[1] & object;

/** the options to spawn with, or a function making them, as copying the environment is costly and only needed on a start */
export type SpawnOptions = WorkerOptions | (() => WorkerOptions);

interface SpawnParams {
  workerPath: string;
  /** the executable and its arguments, ending with the worker file for the runners that take it as their last argument */
  command: string[];
  options: SpawnOptions;
  /** receives the messages of all requests of the worker, with the worker they came from */
  onMessage: (message: WorkerOutputEvent, worker: Worker) => void;
  /** receive what the worker writes to its stdout and stderr, attached once when it starts */
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  /** receive what it writes line by line, see `createLineSplitter` */
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

const listenToOutput = (stream: Readable | null, onData?: (data: Buffer) => void, onLine?: (line: string) => void) => {
  if (onData) stream?.on('data', onData);
  if (!onLine) return;

  // one for each stream of each worker, so that the pieces of two outputs do not end up in one line
  const lines = createLineSplitter(onLine);
  stream?.on('data', lines.write);
  stream?.on('end', lines.end);
};

/** Starts the process of a worker with its stdio layout, and the channel its messages go through. */
const spawnWorker = ({
  workerPath,
  command,
  options,
  onMessage,
  onStdout,
  onStderr,
  onStdoutLine,
  onStderrLine,
}: SpawnParams): { instance: Worker; channel: Channel<WorkerInputEvent> } => {
  // messages go through the socket pair (fourth stdio) instead of node's JSON IPC, which only carries handed-over client sockets
  // 'overlapped' is a plain pipe except on Windows, where a worker could not read and write it at once otherwise
  const instance = new Worker(command, {
    ...(typeof options === 'function' ? options() : options),
    stdio: ['pipe', 'pipe', 'pipe', 'overlapped', 'ipc'],
  });
  // an unhandled error event would take the whole process down, for example when the process could not be spawned
  instance.instance.on('error', (error) => console.error(error));
  const socket = instance.instance.stdio[3];
  if (!(socket instanceof Duplex)) {
    instance.terminate();
    throw new Error(`The worker ${workerPath} has no channel.`);
  }

  // a single listener dispatches the messages of all requests of the worker
  const channel = createChannel<WorkerOutputEvent, WorkerInputEvent>(socket, (message) => onMessage(message, instance));

  // once per worker and from the start, so that nothing it writes waits unread in the pipe
  listenToOutput(instance.instance.stdout, onStdout, onStdoutLine);
  listenToOutput(instance.instance.stderr, onStderr, onStderrLine);

  return { instance, channel };
};

export default spawnWorker;
