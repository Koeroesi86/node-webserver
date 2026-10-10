import express from 'express';
import http from 'http';
import vHost from 'vhost';
import { performance } from 'perf_hooks';
import virtualHostRouter from './virtual-host-router';
import type { AddressInfo } from 'net';
import type { Express } from 'express';
import type { VirtualHost } from '../types/virtual-host';

export interface VirtualHostsBenchmark {
  hostCount: number;
  /** mean time of a request to the last host, in milliseconds */
  vhostPerHost: number;
  router: number;
}

const requestMean = async (app: Express, hostname: string, requests: number): Promise<number> => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const request = () =>
    new Promise<void>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, agent, headers: { Host: hostname } }, (response) => response.resume().on('end', resolve)).on('error', reject);
    });

  try {
    // the first requests warm the code up and open the connection
    for (let warmUp = 0; warmUp < Math.min(requests, 200); warmUp += 1) {
      await request();
    }
    const start = performance.now();
    for (let count = 0; count < requests; count += 1) {
      await request();
    }
    return (performance.now() - start) / requests;
  } finally {
    agent.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
};

/** the time of a request to the last of many hosts, with a vhost middleware per host as before and with the router */
async function benchmarkVirtualHosts(hostCount: number, requests: number): Promise<VirtualHostsBenchmark> {
  const hosts: VirtualHost[] = Array.from({ length: hostCount }, (value, index) => ({
    hostname: `host-${index}.localhost`,
    handler: (request, response) => {
      response.end('ok');
    },
  }));
  const lastHost = `host-${hostCount - 1}.localhost`;
  const vhostApp = hosts.reduce((app, { hostname, handler }) => app.use(vHost(hostname, handler)), express());

  return {
    hostCount,
    vhostPerHost: await requestMean(vhostApp, lastHost, requests),
    router: await requestMean(express().use(virtualHostRouter(hosts)), lastHost, requests),
  };
}

export default benchmarkVirtualHosts;
