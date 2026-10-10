import { countReloads, createReloadedFolder, until as untilHolds } from './helpers/reloaded-folder';
import { startServer } from './helpers/start-server';
import type { RunningServer } from './helpers/start-server';

// a signal that is not SIGINT or SIGTERM cannot be sent to a process on Windows, which ends it
const itWithSignals = process.platform === 'win32' ? it.skip : it;

describe('the options of the reload', () => {
  const folder = createReloadedFolder();
  const servers: RunningServer[] = [];

  /** the server with the file of the folder among its servers, and the system log on to read the reloads from */
  const start = async (env: Record<string, string> = {}) => {
    const server = await startServer({ RELOADED_SERVER: folder.file, SYSTEM_LOGS: 'true', ...env });
    servers.push(server);
    return server;
  };
  const status = async (server: RunningServer, host: string) => (await server.get(host)).status;
  const serves = (server: RunningServer, host: string) => untilHolds(server, async () => (await status(server, host)) === 200);

  beforeEach(() => {
    folder.writeServer();
  });

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    folder.remove();
  });

  describe('with reloadOnSighup', () => {
    itWithSignals('loads the servers again on SIGHUP, and the process stays alive', async () => {
      folder.writeHostname('before-sighup.localhost');
      const server = await start({ RELOAD_ON_SIGHUP: 'true', WATCH_SERVERS: 'false' });
      await serves(server, 'before-sighup.localhost');

      folder.writeHostname('after-sighup.localhost');
      server.signal('SIGHUP');

      await serves(server, 'after-sighup.localhost');
      expect(await status(server, 'before-sighup.localhost')).toBe(404);
      expect(server.hasExited()).toBe(false);
      // the other servers kept answering
      expect(await status(server, 'worker.localhost')).toBe(200);
    });
  });

  describe('without it', () => {
    itWithSignals('still ends the process on SIGHUP, as when the terminal is closed', async () => {
      folder.writeHostname('default-sighup.localhost');
      const server = await start();
      await serves(server, 'default-sighup.localhost');

      server.signal('SIGHUP');

      await server.exited;
      expect(server.hasExited()).toBe(true);
    });
  });

  describe('with watchServers: false', () => {
    it('does not see a changed file, and loads it when it is told to', async () => {
      folder.writeHostname('before-reload.localhost');
      const server = await start({ WATCH_SERVERS: 'false' });
      await serves(server, 'before-reload.localhost');

      folder.writeHostname('after-reload.localhost');
      // there is nothing to wait for when nothing happens: a watcher would have loaded the servers again a long time before this (it waits 100 ms after the last write)
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(await status(server, 'after-reload.localhost')).toBe(404);
      expect(await status(server, 'before-reload.localhost')).toBe(200);
      expect(countReloads(server)).toBe(0);

      server.reload();

      await serves(server, 'after-reload.localhost');
      expect(await status(server, 'before-reload.localhost')).toBe(404);
      expect(countReloads(server)).toBe(1);
    });
  });

  describe('when the file is written several times in a row', () => {
    it('loads the servers again once', async () => {
      folder.writeHostname('before-burst.localhost');
      const server = await start();
      await serves(server, 'before-burst.localhost');
      const before = countReloads(server);

      // far enough apart for a server that does not wait to load the servers again between two of them, and within the 100 ms it waits after the last one
      for (const hostname of ['burst-1', 'burst-2', 'burst-3', 'burst-4', 'burst-5']) {
        folder.writeHostname(`${hostname}.localhost`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      await serves(server, 'burst-5.localhost');
      expect(countReloads(server)).toBe(before + 1);
    });
  });
});
