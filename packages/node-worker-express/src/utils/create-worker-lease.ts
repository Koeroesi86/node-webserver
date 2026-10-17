import type { Socket } from 'node:net';
import type Worker from '@koeroesi86/node-worker';
import type { Channel } from './createChannel';
import type { LeaseState, WorkerRegistry } from './create-worker-registry';
import type { HandOffMessage, HandBackMessage, WorkerInputEvent, WorkerOutputEvent } from '../types';

/** A worker handed out for one request, it counts as load for the worker until it is released. */
export interface WorkerLease {
  readonly worker: Worker;
  /** sends a message to the worker */
  send: (message: WorkerInputEvent) => void;
  /**
   * `onMessage` receives the messages of the worker for the request, `onExit` is called when the worker dies before the lease is released,
   * `onHandBack` takes the connection if the worker gives it back after a handed over request
   */
  subscribe: (
    requestId: string,
    onMessage: (message: WorkerOutputEvent) => void,
    onExit: (code: number | null) => void,
    onHandBack?: (message: HandBackMessage, socket: Socket) => void
  ) => void;
  /**
   * gives the connection of the client to the worker, along with the message, over the IPC channel. The socket is closed in this process once it was sent,
   * the promise rejects when it could not be sent
   */
  handOff: (message: HandOffMessage, socket: Socket) => Promise<void>;
  /** frees the worker for other requests, safe to call more than once */
  release: () => void;
}

interface LeaseParams {
  worker: Worker;
  registry: WorkerRegistry<Worker, Channel<WorkerInputEvent>>;
  /** called once the lease is released, after the worker is free */
  onReleased: () => void;
}

/** counts the request as a load of the worker right away, before anything else can look at the worker */
const createWorkerLease = ({ worker, registry, onReleased }: LeaseParams): WorkerLease => {
  const state: LeaseState = {};
  registry.addLease(worker, state);

  return {
    worker,
    send: (message) => registry.getChannel(worker)?.send(message),
    handOff: (message, socket) =>
      new Promise<void>((resolve, reject) => {
        if (!worker.instance.connected) {
          reject(new Error('The worker has no IPC channel.'));
          return;
        }
        worker.instance.send(message, socket, (error) => (error ? reject(error) : resolve()));
      }),
    subscribe: (requestId, onMessage, onExit, onHandBack) => {
      Object.assign(state, { onMessage, onExit, onHandBack });
      registry.subscribe(state, requestId);
    },
    release: () => {
      registry.removeLease(worker, state);
      const entry = registry.getEntry(worker);
      if (entry !== undefined && registry.getLoad(worker) === 0) {
        entry.lastUsed = Date.now();
        entry.idleTimer?.refresh();
      }
      onReleased();
    },
  };
};

export default createWorkerLease;
