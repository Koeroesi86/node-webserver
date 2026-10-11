import type { ChildProcess } from 'node:child_process';
import { Duplex } from 'node:stream';
import type { ChannelMode } from '../types/channel-bench';
import { loadCreateChannel } from './load-create-channel';

const headers = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`x-header-${index}`, 'value '.repeat(4)]));

/** how requests are sent to the child, and `answered` is called with every answer: over the IPC of node, or over the socket pair of the server */
export const connectBenchChild = (child: ChildProcess, mode: ChannelMode, answered: (message: { requestId: string }) => void) => {
  if (mode === 'ipc') {
    child.on('message', answered);
    return (requestId: string, body: Buffer | undefined) =>
      child.send({ type: 'REQUEST', requestId, event: { headers, ...(body && { inlineBody: body.toString('base64') }) } });
  }

  const socket = child.stdio[3];
  if (!(socket instanceof Duplex)) throw new Error('The child has no channel.');
  const channel = loadCreateChannel()(socket, answered);

  return (requestId: string, body: Buffer | undefined) => channel.send({ type: 'REQUEST', requestId, event: { headers, ...(body && { body }) } });
};
