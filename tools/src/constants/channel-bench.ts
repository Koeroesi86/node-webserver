import type { ChannelBenchCase } from '../types/channel-bench';

/** the messages a worker gets: a request without a body, and bodies from the size of a form to the size of a file */
export const channelBenchCases: ChannelBenchCase[] = [
  { name: 'no body, 1 in flight', messages: 20000, inFlight: 1, bodySize: 0 },
  { name: 'no body, 64 in flight', messages: 100000, inFlight: 64, bodySize: 0 },
  { name: '4 KiB body, 64 in flight', messages: 50000, inFlight: 64, bodySize: 4 * 1024 },
  { name: '64 KiB body, 16 in flight', messages: 10000, inFlight: 16, bodySize: 64 * 1024 },
  { name: '1 MiB body, 4 in flight', messages: 600, inFlight: 4, bodySize: 1024 * 1024 },
];

/** messages sent before the measuring, so that the JIT and the pipe are warm */
export const channelBenchWarmUp = 5000;
