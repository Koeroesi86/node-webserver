import { createServer, type Server } from 'node:http';

const getPort = (server: Server) => {
  const address = server.address();

  return typeof address === 'object' && address !== null ? address.port : 0;
};

/** a server on a free port that answers every request with the status, `stop` frees the port again */
export const startHttpServer = async (status = 200) => {
  const server = createServer((request, response) => response.writeHead(status).end(request.headers.host));
  await new Promise<void>((done) => server.listen(0, () => done()));

  return {
    port: String(getPort(server)),
    stop: () => new Promise<void>((done) => server.close(() => done())),
  };
};
