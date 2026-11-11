import { request } from 'node:http';
import type { Endpoint } from '../types/warm-up';

/** the status that the endpoint answers with, undefined when it does not answer */
export const requestEndpoint = (port: string, { host, path, method = 'GET', body }: Endpoint, timeoutMs = 5000) =>
  new Promise<number | undefined>((done) => {
    const probe = request({ host: 'localhost', port, path, method, headers: { Host: host }, timeout: timeoutMs }, (response) => {
      response.resume();
      done(response.statusCode);
    });
    probe.on('error', () => done(undefined));
    probe.on('timeout', () => probe.destroy());
    probe.end(body);
  });
