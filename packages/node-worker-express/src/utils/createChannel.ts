import { ChannelMaxFrameLength } from '../constants';
import { encodeMessage, FrameDecoder } from './frames';
import type { Duplex } from 'stream';
import type { WireMessage } from './frames';

export interface Channel<Outgoing extends WireMessage> {
  /** false when the message was not written: the stream is gone, or the message does not fit into a frame, which the other end would close the channel for */
  send: (message: Outgoing) => boolean;
}

/**
 * Exchanges messages over a duplex stream, in practice the socket pair to a worker: a Unix domain socket, or a named pipe on Windows.
 *
 * Messages written during the same turn of the event loop leave in a single write. Under load this saves more than half of the system calls
 * and of the time spent in them, and costs at most the rest of the current loop iteration.
 *
 * A write does not wait for the stream to drain. What waits in the stream is bounded by the requests in flight instead: each gets one response,
 * and streamed bodies and websocket messages wait for acknowledgements. Pausing the reading while the writes wait would let both ends wait for each other.
 */
export default function createChannel<Incoming extends WireMessage, Outgoing extends WireMessage>(
  socket: Duplex,
  onMessage: (message: Incoming) => void
): Channel<Outgoing> {
  const decoder = new FrameDecoder<Incoming>(onMessage);
  let corked = false;

  socket.on('data', (chunk: Buffer) => {
    try {
      decoder.push(chunk);
    } catch (error) {
      // what comes next cannot be told from garbage, closing is left to the owner, who learns about it as the stream ends
      socket.destroy(error instanceof Error ? error : undefined);
    }
  });
  // a stream that breaks ends with a close, which the owner of the channel handles
  socket.on('error', () => {});

  const uncork = () => {
    corked = false;
    socket.uncork();
  };

  return {
    send: (message) => {
      if (socket.destroyed || !socket.writable) return false;

      const parts = encodeMessage(message);
      // the frame starts with its length
      if (parts[0].readUInt32LE(0) > ChannelMaxFrameLength) return false;

      if (!corked) {
        corked = true;
        socket.cork();
        setImmediate(uncork);
      }
      parts.forEach((part) => socket.write(part));
      return true;
    },
  };
}
