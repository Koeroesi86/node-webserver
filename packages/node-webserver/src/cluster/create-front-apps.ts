import type { FrontMessage, PortLookup, RunningApp, SharedApps } from '../types';

interface Wanted {
  /** how many servers of the front want the application */
  count: number;
  port: Promise<number>;
  resolve: (port: number) => void;
  reject: (error: Error) => void;
}

const createWanted = (): Wanted => {
  let resolve: Wanted['resolve'] = () => {};
  let reject: Wanted['reject'] = () => {};
  const port = new Promise<number>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { count: 0, port, resolve, reject };
};

/** The applications of the `child` servers of a front, which the primary starts: the front says which ones its servers want, and what to start on the port it is told. */
const createFrontApps = (send: (message: FrontMessage) => unknown, kill: (pid: number) => unknown = process.kill) => {
  const apps = new Map<string, Wanted>();
  /** the applications that run, as the primary said last */
  let running: RunningApp[] = [];

  const shared: SharedApps = {
    claim: (key: string, { port, lookup }: { port?: number; lookup?: PortLookup }) => {
      const app = apps.get(key) ?? createWanted();
      apps.set(key, app);
      app.count += 1;
      if (app.count === 1) send({ nodeWebserver: 'app-claim', key, port, lookup });

      return app.port;
    },
    start: (key, hostname, command, args) => void send({ nodeWebserver: 'app-start', key, hostname, command, args }),
    pid: (key) => running.find((app) => app.key === key)?.pid,
    release: (key) => {
      const app = apps.get(key);
      if (!app) return;

      app.count -= 1;
      if (app.count > 0) return;
      apps.delete(key);
      send({ nodeWebserver: 'app-release', key });
    },
  };

  const end = (pid: number) => {
    try {
      kill(pid);
    } catch {
      // it ended already
    }
  };

  return {
    ...shared,
    runs: (apps: RunningApp[]) => {
      running = apps;
    },
    /** ends the applications, for a front that finds the primary gone */
    endAll: () => running.forEach(({ pid }) => end(pid)),
    receive: ({ key, port, error }: { key: string; port?: number; error?: string }) => {
      if (port === undefined) apps.get(key)?.reject(new Error(error));
      else apps.get(key)?.resolve(port);
    },
  };
};

export default createFrontApps;
