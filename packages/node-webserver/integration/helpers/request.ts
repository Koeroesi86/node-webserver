import http from 'http';

export interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
  json: () => unknown;
  /** the request was sent on a connection that an earlier request had used */
  reusedSocket: boolean;
}

export interface RequestOptions {
  port: number;
  /** the virtual host to ask for */
  host: string;
  path?: string;
  method?: string;
  body?: string;
  headers?: http.OutgoingHttpHeaders;
  /** a new connection for every request unless an agent that keeps them is given */
  agent?: http.Agent;
}

/** a request to the loopback address with the host name of the virtual host, as names below localhost are not resolved everywhere */
export const request = ({ port, host, path = '/', method = 'GET', body, headers = {}, agent }: RequestOptions): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const outgoing = http.request({ host: '127.0.0.1', port, path, method, headers: { ...headers, Host: host }, agent: agent ?? false }, (response) => {
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => parts.push(part));
      response.on('error', reject);
      response.on('end', () => {
        const buffer = Buffer.concat(parts);
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: buffer,
          text: buffer.toString('utf8'),
          json: () => JSON.parse(buffer.toString('utf8')),
          reusedSocket: outgoing.reusedSocket,
        });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
