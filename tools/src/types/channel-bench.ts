export type ChannelMode = 'ipc' | 'socket';

export interface ChannelBenchCase {
  name: string;
  messages: number;
  /** how many messages wait for their echo at the same time */
  inFlight: number;
  /** bytes of the body of a message, 0 for none */
  bodySize: number;
}

export interface ChannelBenchResult {
  name: string;
  messagesPerSecond: number;
  /** megabytes of body per second, one way */
  bodyMegabytesPerSecond: number;
  /** microseconds of cpu the parent used for a message, the echo of the child included in the wait but not in this */
  parentCpuMicroseconds: number;
  /** microseconds from sending a message to its echo, on average */
  latencyMicroseconds: number;
}

/** the createChannel of node-worker-express, as far as the benchmark uses it */
export type CreateChannel = (
  socket: import('node:stream').Duplex,
  onMessage: (message: { type: string; requestId: string }) => void
) => { send: (message: { type: string; requestId: string; event?: Record<string, unknown> }) => boolean };
