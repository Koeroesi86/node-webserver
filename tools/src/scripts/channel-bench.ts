import { runChannelBench } from '../utils/run-channel-bench';
import { formatChannelBench } from '../utils/format-channel-bench';
import type { ChannelMode } from '../types/channel-bench';

// Measures the channel between the server and a worker on its own, with no HTTP in the way: messages with and without bodies to a child that echoes them.
//   node channel-bench.js [ipc|socket|both, both] [scale of the number of messages, 1]
// `ipc` is the IPC of node that carried the messages before the socket pair (#66), with the body as base64 in the JSON. Needs `pnpm build`, the socket pair is the createChannel of node-worker-express.
// For numbers that can be compared pin the processes the way the load test does, for example `taskset -c 0-2 node tools/dist/scripts/channel-bench.js`.
// The markdown table goes to stdout.

const [which = 'both', scale = '1'] = process.argv.slice(2);
const modes: ChannelMode[] = which === 'both' ? ['ipc', 'socket'] : which === 'ipc' || which === 'socket' ? [which] : [];

if (modes.length === 0 || !(Number(scale) > 0)) {
  console.error('Usage: channel-bench.js [ipc|socket|both, both] [scale of the number of messages, 1]');
  process.exit(2);
}

(async () => {
  const results: Array<{ mode: ChannelMode; results: Awaited<ReturnType<typeof runChannelBench>> }> = [];
  // one after the other, as two at the same time would take the cores from each other
  for (const mode of modes) results.push({ mode, results: await runChannelBench(mode, Number(scale)) });
  console.log(formatChannelBench(results));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
