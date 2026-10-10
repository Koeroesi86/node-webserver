import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { Duplex } from 'node:stream';
import { channelBenchCases, channelBenchWarmUp } from '../constants/channel-bench';
import type { ChannelBenchCase, ChannelBenchResult, ChannelMode } from '../types/channel-bench';
import { loadCreateChannel } from './load-create-channel';

const headers = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`x-header-${index}`, 'value '.repeat(4)]));

/**
 * Sends messages to a child process that echoes them and measures how fast they come back, over the channel a worker is given:
 * `socket` is the socket pair of the server (createChannel), `ipc` what it replaced, the IPC of node with the JSON of a request whose body is base64.
 * `scale` multiplies the number of messages of every case.
 */
export const runChannelBench = async (mode: ChannelMode, scale = 1, cases: ChannelBenchCase[] = channelBenchCases): Promise<ChannelBenchResult[]> => {
  const child = spawn(process.execPath, [resolve(__dirname, '../scripts/channel-bench-child.js'), mode], {
    stdio: ['ignore', 'inherit', 'inherit', mode === 'ipc' ? 'ipc' : 'overlapped'],
  });
  const waiting = new Map<string, () => void>();
  const answered = (message: { requestId: string }) => waiting.get(message.requestId)?.();
  let send: (requestId: string, body: Buffer | undefined) => void;

  if (mode === 'ipc') {
    child.on('message', answered);
    send = (requestId, body) => child.send({ type: 'REQUEST', requestId, event: { headers, ...(body && { inlineBody: body.toString('base64') }) } });
  } else {
    const socket = child.stdio[3];
    if (!(socket instanceof Duplex)) throw new Error('The child has no channel.');
    const channel = loadCreateChannel()(socket, answered);
    send = (requestId, body) => channel.send({ type: 'REQUEST', requestId, event: { headers, ...(body && { body }) } });
  }

  let counter = 0;
  const roundTrip = (body: Buffer | undefined) =>
    new Promise<void>((resolveRoundTrip) => {
      const requestId = String(counter++);
      waiting.set(requestId, () => {
        waiting.delete(requestId);
        resolveRoundTrip();
      });
      send(requestId, body);
    });

  const measure = async ({ name, messages, inFlight, bodySize }: ChannelBenchCase): Promise<ChannelBenchResult> => {
    const count = Math.max(1, Math.round(messages * scale));
    const body = bodySize > 0 ? randomBytes(bodySize) : undefined;
    let sent = 0;
    const lane = async () => {
      while (sent < count) {
        sent += 1;
        await roundTrip(body);
      }
    };
    const cpuBefore = process.cpuUsage();
    const start = process.hrtime.bigint();
    await Promise.all(Array.from({ length: inFlight }, lane));
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const cpu = process.cpuUsage(cpuBefore);

    return {
      name,
      messagesPerSecond: count / seconds,
      bodyMegabytesPerSecond: (count * bodySize) / seconds / 1e6,
      parentCpuMicroseconds: (cpu.user + cpu.system) / count,
      latencyMicroseconds: (seconds * 1e6 * inFlight) / count,
    };
  };

  try {
    // the child has to be up before the first message
    await new Promise((resolveStart) => setTimeout(resolveStart, 300));
    for (let warmed = 0; warmed < Math.max(1, Math.round(channelBenchWarmUp * scale)); warmed += 1) await roundTrip(undefined);
    const results: ChannelBenchResult[] = [];
    for (const benchCase of cases) results.push(await measure(benchCase));

    return results;
  } finally {
    child.kill();
    await once(child, 'close');
  }
};
