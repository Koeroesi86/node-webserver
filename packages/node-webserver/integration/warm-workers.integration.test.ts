import fs from 'fs';
import os from 'os';
import path from 'path';
import { startServer } from './helpers/start-server';
import type { RunningServer } from './helpers/start-server';
import { until } from './helpers/reloaded-folder';

describe('the worker server that is kept warm', () => {
  let server: RunningServer;
  let folder: string;
  let marker: string;

  /** the process ids of the workers the file was written by, one for every start */
  const starts = () => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean) : []);

  beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'warm-'));
    marker = path.join(folder, 'starts');
    server = await startServer({ WARM_MARKER: marker });
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('starts its worker with the server, before any request, and the first request gets that one', async () => {
    await until(server, () => starts().length === 1);

    const reply = await server.get('warm.localhost');

    expect(reply.text).toBe(starts()[0]);
    expect(starts()).toHaveLength(1);
  });

  it('starts a worker again when it is gone, before the next request', async () => {
    const [first] = starts();

    process.kill(Number(first), 'SIGKILL');
    await until(server, () => starts().length === 2);

    const reply = await server.get('warm.localhost');
    expect(starts()[1]).not.toBe(first);
    expect(reply.text).toBe(starts()[1]);
    expect(starts()).toHaveLength(2);
  });
});
