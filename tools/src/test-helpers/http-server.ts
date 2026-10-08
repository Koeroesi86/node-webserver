import { createServer, type Server } from 'node:http';

export interface RecordedRequest {
  host: string;
  method: string;
  path: string;
  body: string;
}

const getPort = (server: Server) => {
  const address = server.address();

  return typeof address === 'object' && address !== null ? address.port : 0;
};

/**
 * a server on a free port that answers every request with the status, which can depend on the request: it is given how many requests the host has had, this one included.
 * `stop` frees the port again, `requests` are the requests it got.
 */
export const startHttpServer = async (status: number | ((count: number, request: RecordedRequest) => number) = 200) => {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const recorded = { host: request.headers.host ?? '', method: request.method ?? '', path: request.url ?? '', body: Buffer.concat(chunks).toString() };
      requests.push(recorded);
      const count = requests.filter(({ host }) => host === recorded.host).length;
      response.writeHead(typeof status === 'function' ? status(count, recorded) : status).end('ok');
    });
  });
  await new Promise<void>((done) => server.listen(0, () => done()));

  return {
    port: String(getPort(server)),
    requests,
    stop: () => new Promise<void>((done) => server.close(() => done())),
  };
};
