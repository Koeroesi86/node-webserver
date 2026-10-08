import { request } from 'node:http';

/** whether the server answers on the port without an error status */
export const isServerUp = (port: string, host = 'web.localhost') =>
  new Promise<boolean>((done) => {
    const probe = request({ host: 'localhost', port, headers: { Host: host }, timeout: 2000 }, (response) => {
      response.resume();
      done(response.statusCode !== undefined && response.statusCode < 400);
    });
    probe.on('error', () => done(false));
    probe.on('timeout', () => probe.destroy());
    probe.end();
  });
