import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';

const script = resolve(__dirname, '../../dist/scripts/version.js');

describe('version script', () => {
  let server: Server;
  let registryUrl = '';

  beforeAll(async () => {
    // a registry that has no package, so that every package of the workspace is new
    server = createServer((request, response) => response.writeHead(404).end());
    await new Promise<void>((done) => server.listen(0, () => done()));
    const address = server.address();
    registryUrl = `http://localhost:${typeof address === 'object' && address !== null ? address.port : 0}`;
  });

  afterAll(() => new Promise((done) => server.close(done)));

  /** not spawnSync, as the registry is served by this process */
  const run = (env: Record<string, string>) =>
    new Promise<{ status: number | null; stdout: string }>((done) => {
      const child = spawn('node', [script], { env: { PATH: process.env.PATH ?? '', ...env } });
      let stdout = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.on('close', (status) => done({ status, stdout }));
    });

  it('finds the packages of the workspace and plans a new version for each when nothing is published', async () => {
    const { status, stdout } = await run({ GITHUB_RUN_ID: '42', GITHUB_REF_NAME: 'feature/x', NPM_REGISTRY_URL: registryUrl, VERSION_DRY_RUN: '1' });

    expect(status).toBe(0);
    expect(stdout).toMatch(/@koeroesi86\/node-webserver: \d\d\.\d\d\.42-feature-x \(never published\)/);
    expect(stdout).toContain('@koeroesi86/node-worker:');
    expect(stdout).not.toContain('@koeroesi86/tools');
  });

  it('fails without the branch or the run', () => {
    const fail = (env: Record<string, string>) => spawnSync('node', [script], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

    expect(fail({ GITHUB_RUN_ID: '1' }).status).toBe(1);
    expect(fail({ GITHUB_REF_NAME: 'main' }).stderr).toContain('GITHUB_RUN_ID');
  });
});
