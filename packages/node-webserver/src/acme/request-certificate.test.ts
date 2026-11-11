import { X509Certificate, createPrivateKey } from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import createAcmeChallengeHandler from './create-acme-challenge-handler';
import startFakeAcmeServer from './fake-acme-server.test-helper';
import requestCertificate from './request-certificate';
import type { FakeAcmeServer } from './fake-acme-server.test-helper';
import type { AcmeChallenges } from '../types';

describe('requestCertificate', () => {
  let folder: string;
  let challengeServer: http.Server;
  let authority: FakeAcmeServer;
  const challenges: AcmeChallenges = new Map();

  beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'request-certificate-'));
    challengeServer = http.createServer(express().use(createAcmeChallengeHandler(challenges)));
    await new Promise<void>((resolve) => challengeServer.listen(0, resolve));
    authority = await startFakeAcmeServer(folder, () => (challengeServer.address() as { port: number }).port);
  });

  afterAll(async () => {
    await authority.stop();
    await new Promise((resolve) => challengeServer.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  });

  afterEach(() => {
    authority.behaviour.rejectChallenges = false;
    authority.behaviour.stallChallenges = false;
  });

  const order = (hostname = 'secure.example.com') => ({
    hostname,
    challenges,
    pollInterval: 5,
    acme: { email: 'admin@example.com', storagePath: path.join(folder, 'storage'), directory: authority.directory, directoryCa: authority.ca },
  });

  it('gets a certificate for the host name and a new key, through the whole order', async () => {
    const { key, chain } = await requestCertificate(order());
    const certificate = new X509Certificate(chain);

    expect(certificate.checkHost('secure.example.com')).toBe('secure.example.com');
    expect(certificate.checkPrivateKey(createPrivateKey(key))).toBe(true);
    expect(authority.requests.filter((request) => request.startsWith('POST /new-order'))).toHaveLength(1);
  });

  it('answers the challenge while it waits, and takes the answer away once it is done', async () => {
    const seen: number[] = [];
    const watch = setInterval(() => seen.push(challenges.size), 1);

    await requestCertificate(order());
    clearInterval(watch);

    expect(Math.max(...seen)).toBe(1);
    expect(challenges.size).toBe(0);
  });

  it('keeps the account key and finds the same account again', async () => {
    await requestCertificate(order());
    const keys = fs.readdirSync(path.join(folder, 'storage')).filter((file) => file.startsWith('account-'));
    await requestCertificate(order());

    expect(keys).toHaveLength(1);
    expect(fs.readdirSync(path.join(folder, 'storage')).filter((file) => file.startsWith('account-'))).toEqual(keys);
  });

  it('fails with what the authority said when it cannot reach the host, and takes the answer away', async () => {
    authority.behaviour.rejectChallenges = true;

    await expect(requestCertificate(order())).rejects.toThrow(/invalid: could not fetch the token/);
    expect(challenges.size).toBe(0);
  });

  it('fails on a directory it does not trust', async () => {
    await expect(requestCertificate({ ...order(), acme: { ...order().acme, directoryCa: undefined } })).rejects.toThrow(/self.signed|certificate/i);
  });

  it('gives up on a challenge that is not decided after the looks it was given, and takes the answer away', async () => {
    authority.behaviour.stallChallenges = true;

    await expect(requestCertificate({ ...order(), maxPolls: 3 })).rejects.toThrow(/is still pending after 3 looks/);
    expect(challenges.size).toBe(0);
  });
});
