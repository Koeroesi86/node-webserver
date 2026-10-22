import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import createAcmeChallengeHandler from './create-acme-challenge-handler';
import createAcmeRenewer from './create-acme-renewer';
import startFakeAcmeServer from './fake-acme-server.test-helper';
import createMockLogger from './mock-logger.test-helper';
import type { FakeAcmeServer } from './fake-acme-server.test-helper';
import type { AcmeChallenges, LoadedInstance, ServerConfig } from '../types';

describe('createAcmeRenewer', () => {
  let folder: string;
  let challengeServer: http.Server;
  let authority: FakeAcmeServer;
  const challenges: AcmeChallenges = new Map();

  beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-renewer-'));
    challengeServer = http.createServer(express().use(createAcmeChallengeHandler(challenges)));
    await new Promise<void>((resolve) => challengeServer.listen(0, resolve));
    authority = await startFakeAcmeServer(folder, () => (challengeServer.address() as { port: number }).port);
  });

  afterAll(async () => {
    await authority.stop();
    await new Promise((resolve) => challengeServer.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  });

  beforeEach(() => {
    authority.requests.splice(0);
    authority.hostnames.splice(0);
  });

  afterEach(() => {
    authority.behaviour.rejectChallenges = false;
  });

  const storagePath = () => path.join(folder, 'storage');
  const acme = () => ({ email: 'admin@example.com', storagePath: storagePath(), directory: authority.directory, directoryCa: authority.ca });
  const loaded = (overrides: Partial<ServerConfig> = {}) => {
    const instance: ServerConfig = { hostname: 'secure.example.com', protocol: 'https', acme: acme(), ...overrides };
    // the files are the ones the server gets while it is loaded
    return {
      source: instance,
      instance: {
        ...instance,
        key: path.join(storagePath(), instance.hostname, 'privkey.pem'),
        cert: path.join(storagePath(), instance.hostname, 'fullchain.pem'),
      },
      runtime: {},
    } as LoadedInstance;
  };

  const renewer = (servers: LoadedInstance[]) => {
    const logger = createMockLogger();
    const reload = jest.fn();

    return { logger, reload, ...createAcmeRenewer({ getLoaded: () => servers, challenges, logger, reload, pollInterval: 5 }) };
  };

  it('gets the certificate of a server that has none, writes it where the server reads it and loads the servers again', async () => {
    const server = loaded();
    const { check, reload, logger } = renewer([server]);

    await check();

    expect(fs.readFileSync(server.instance.cert as string, 'utf8')).toContain('BEGIN CERTIFICATE');
    expect(fs.readFileSync(server.instance.key as string, 'utf8')).toContain('PRIVATE KEY');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Certificate for secure.example.com issued'));
  });

  it('leaves a certificate that is not about to expire', async () => {
    const server = loaded({ hostname: 'kept.example.com' });
    const first = renewer([server]);
    await first.check();
    authority.requests.splice(0);

    const second = renewer([server]);
    await second.check();

    expect(authority.requests).toEqual([]);
    expect(second.reload).not.toHaveBeenCalled();
  });

  it('renews one that is within the days it was told', async () => {
    const server = loaded({ hostname: 'renewed.example.com' });
    await renewer([server]).check();
    const due = loaded({ hostname: 'renewed.example.com', acme: { ...acme(), renewBeforeDays: 365 } });
    const { check, reload } = renewer([due]);

    await check();

    expect(authority.hostnames).toEqual(['renewed.example.com', 'renewed.example.com']);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('looks only at the https servers with acme and a name without a wildcard', async () => {
    const { check, reload } = renewer([
      loaded({ hostname: 'plain.example.com', acme: undefined }),
      loaded({ hostname: '*.example.com' }),
      loaded({ hostname: 'insecure.example.com', protocol: 'http' }),
    ]);

    await check();

    expect(authority.requests).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('logs a server it could not get a certificate for, keeps going with the others and loads the servers again for the ones it got', async () => {
    const good = loaded({ hostname: 'good.example.com' });
    const bad = loaded({ hostname: 'bad.example.com', acme: { ...acme(), directory: 'https://localhost:1/directory' } });
    const { check, reload, logger } = renewer([bad, good]);

    await check();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Certificate for bad.example.com was not issued'), expect.anything());
    expect(fs.existsSync(bad.instance.cert as string)).toBe(false);
    expect(fs.existsSync(good.instance.cert as string)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not load the servers again when nothing was issued', async () => {
    authority.behaviour.rejectChallenges = true;
    const { check, reload, logger } = renewer([loaded({ hostname: 'rejected.example.com' })]);

    await check();

    expect(reload).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not start a second order while one is being made', async () => {
    const { check } = renewer([loaded({ hostname: 'slow.example.com' })]);

    await Promise.all([check(), check()]);

    expect(authority.hostnames).toEqual(['slow.example.com']);
  });

  it('looks when it starts and every interval after, until it is stopped', async () => {
    jest.useFakeTimers();
    const getLoaded = jest.fn(() => []);
    const instance = createAcmeRenewer({ getLoaded, challenges, logger: createMockLogger(), reload: jest.fn(), interval: 1000 });

    await instance.start();
    await jest.advanceTimersByTimeAsync(2500);
    instance.stop();
    await jest.advanceTimersByTimeAsync(5000);
    jest.useRealTimers();

    expect(getLoaded).toHaveBeenCalledTimes(3);
  });
});
