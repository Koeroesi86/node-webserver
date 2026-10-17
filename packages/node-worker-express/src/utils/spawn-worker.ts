import net from 'net';
import { Duplex } from 'stream';
import Worker from '@koeroesi86/node-worker';
import createChannel from './createChannel';
import createWorkerCommand from './create-worker-command';
import type { Channel } from './createChannel';
import isRequestHandBack from './is-request-hand-back';
import isResponseHandBack from './is-response-hand-back';
import type { HandBackMessage, WorkerInputEvent, WorkerOutputEvent } from '../types';

/** the options to spawn with, or a function making them, as copying the environment is costly and only needed on a start */
export type SpawnOptions = object | (() => object);

interface SpawnParams {
  workerPath: string;
  options: SpawnOptions;
  /** receives the messages of all requests of the worker */
  onMessage: (message: WorkerOutputEvent) => void;
  /** receives the connection of a handed over request that the worker gives back, over the IPC channel */
  onHandBack: (message: HandBackMessage, socket: net.Socket) => void;
  /** receive what the worker writes to its stdout and stderr, attached once when it starts */
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
}

/** Starts the process of a worker with its stdio layout, and the channel its messages go through. */
const spawnWorker = ({
  workerPath,
  options,
  onMessage,
  onHandBack,
  onStdout,
  onStderr,
}: SpawnParams): { instance: Worker; channel: Channel<WorkerInputEvent> } => {
  // messages go through the socket pair (fourth stdio) instead of node's JSON IPC, which only carries handed-over client sockets
  // 'overlapped' is a plain pipe except on Windows, where a worker could not read and write it at once otherwise
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

  instance.instance.on('message', (message: unknown, handle: unknown) => {
    if ((isRequestHandBack(message) || isResponseHandBack(message)) && handle instanceof net.Socket) onHandBack(message, handle);
    else if (handle instanceof net.Socket) handle.destroy();
  });

  // once per worker and from the start, so that nothing it writes waits unread in the pipe
  if (onStdout) instance.instance.stdout?.on('data', onStdout);
  if (onStderr) instance.instance.stderr?.on('data', onStderr);

  return { instance, channel };
};

export default spawnWorker;
