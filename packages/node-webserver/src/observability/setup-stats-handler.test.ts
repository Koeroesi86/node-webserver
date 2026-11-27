import express from 'express';
import http from 'http';
import type net from 'net';
import pidUsage from 'pidusage';
import setupStatsHandler from './setup-stats-handler';
import createMockLogger from './mock-logger.test-helper';
import type { ServerState } from '../types';

jest.mock('pidusage', () => ({ __esModule: true, default: jest.fn(async (pid: number) => ({ pid, cpu: 1 })) }));

describe('setupStatsHandler', () => {
  it('answers on the stats domain with the usage of the fronts and of the applications of the child servers, also of one that the primary runs', async () => {
    const child = (url: string, runtime: ServerState['runtime']): ServerState => ({
      instance: { hostname: 'child.localhost', protocol: 'http', type: 'child', serverOptions: { protocol: 'http', url } },
      runtime,
    });
    const instances = [child('own.localhost', { child: { pid: 11 } as never }), child('shared.localhost', { appPid: () => 22 })];
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const app = express();
    jest.mocked(pidUsage).mockImplementation((async (pid: number) => {
      if (pid === 33) throw new Error('no such process');
      return { pid, cpu: 1 };
    }) as never);
    const fronts = { front: 2, list: () => ({ 1: 31, 2: 32, 3: 33 }) };
    setupStatsHandler(() => instances, app, { statsDomain: 'stats.localhost', statsRefreshInterval: 1000 }, createMockLogger(), fronts);
    await new Promise((resolve) => setImmediate(resolve));
    jest.useRealTimers();
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    const body = await new Promise<string>((resolve, reject) =>
      http
        .get({ port: (server.address() as net.AddressInfo).port, headers: { Host: 'stats.localhost' }, agent: false }, (response) => {
          let text = '';
          response.on('data', (part: Buffer) => (text += part));
          response.on('end', () => resolve(text));
        })
        .on('error', reject)
    );
    server.close();

    expect(pidUsage).toHaveBeenCalledWith(22);
    expect(JSON.parse(body)).toMatchObject({ front: 2, fronts: { 1: { pid: 31 }, 2: { pid: 32 } } });
    expect(JSON.parse(body).fronts).not.toHaveProperty('3');
    expect(JSON.parse(body).child).toEqual({
      'own.localhost': { url: 'own.localhost', stats: { pid: 11, cpu: 1 } },
      'shared.localhost': { url: 'shared.localhost', stats: { pid: 22, cpu: 1 } },
    });
  });
});
