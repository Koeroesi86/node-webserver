import net from 'node:net';
import { loadCreateChannel } from '../utils/load-create-channel';

// The other end of channel-bench.js: gives every message back as it came.
const [mode] = process.argv.slice(2);

if (mode === 'ipc') {
  process.on('message', (message) => process.send?.(message));
} else {
  const socket = new net.Socket({ fd: 3, readable: true, writable: true });
  const channel = loadCreateChannel()(socket, (message) => channel.send(message));
  // the parent closes the channel when it is done
  socket.on('close', () => process.exit(0));
}
