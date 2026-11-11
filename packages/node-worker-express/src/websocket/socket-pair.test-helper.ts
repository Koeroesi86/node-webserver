import net from 'net';

/** a connection over localhost: the end a client uses, and the end a server holds, not read until the test does. `close` ends both. */
export const createSocketPair = async () => {
  const server = net.createServer({ pauseOnConnect: true });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const accepted = new Promise<net.Socket>((resolve) => server.once('connection', resolve));
  const client = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1');
  const connection = await accepted;

  return {
    client,
    connection,
    close: () => {
      client.destroy();
      connection.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
};

/** everything the socket receives, once it is closed */
export const readUntilClosed = (socket: net.Socket) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('close', () => resolve(Buffer.concat(chunks).toString()));
  });
