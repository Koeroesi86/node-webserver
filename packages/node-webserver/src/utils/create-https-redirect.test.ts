import express from 'express';
import http from 'http';
import createHttpsRedirect from './create-https-redirect';
import type { ServerConfig } from '../types';

describe('createHttpsRedirect', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  const request = async (
    redirect: Exclude<ServerConfig['redirectHttp'], false | undefined>,
    portHttps: number | undefined,
    path: string,
    method = 'GET',
    host?: string
  ) => {
    const server = http.createServer(express().use(createHttpsRedirect(redirect, portHttps)));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    return new Promise<http.IncomingMessage>((resolve, reject) => {
      http
        .request(
          { port: (server.address() as { port: number }).port, path, method, headers: host === undefined ? { Host: 'Secure.Localhost:8080' } : { Host: host } },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response));
          }
        )
        .on('error', reject)
        .end();
    });
  };

  it('redirects with 308, which keeps the method, to the same address on https', async () => {
    const response = await request(true, 443, '/a/b', 'POST');

    expect(response.statusCode).toBe(308);
    expect(response.headers.location).toBe('https://secure.localhost/a/b');
  });

  it('keeps the query string and puts the port in when it is not 443', async () => {
    const response = await request({}, 8443, '/search?q=a%20b&x=1');

    expect(response.headers.location).toBe('https://secure.localhost:8443/search?q=a%20b&x=1');
  });

  it('uses the status that was asked for', async () => {
    expect((await request({ status: 301 }, 443, '/')).statusCode).toBe(301);
  });

  it('does not let a path that starts with slashes leave the host', async () => {
    expect((await request(true, 443, '//evil.example/x')).headers.location).toBe('https://secure.localhost//evil.example/x');
  });
});
