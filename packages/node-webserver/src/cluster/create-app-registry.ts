import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { setupChildListener } from '../children';
import createPortPool from './create-port-pool';
import { getDate } from '../utils';
import type { AppRegistry, FrontServiceMessage, Logger, PortLookup, PrimaryMessage } from '../types';

interface Member {
  send: (message: PrimaryMessage) => void;
  /** the applications the servers of the front want */
  holds: Set<string>;
  /** whether it said what its servers are */
  serves?: boolean;
}

interface App {
  /** resolves with the port once it is known */
  port: Promise<number>;
  number?: number;
  /** set by the configuration, and not one of the pool */
  fixed: boolean;
  /** what to start once the port is free */
  waiting?: { command: string; args: string[] };
  child?: ChildProcess;
  /** a front said what to start, which the first one does */
  ordered?: boolean;
  /** no front wants it any more */
  removed?: boolean;
}

interface Dependencies {
  ports?: ReturnType<typeof createPortPool>;
  start?: typeof spawn;
}

/**
 * The applications of the `child` servers of a server with fronts: the primary starts each one once, on a port it picks, for all the fronts that want it, and stops it once none does.
 * An application that changed is another one, started next to it. Where both have the same port of the configuration, the new one starts once the old one ended.
 */
const createAppRegistry = (logger: Logger, { ports = createPortPool(), start = spawn }: Dependencies = {}): AppRegistry => {
  const members = new Set<Member>();
  const apps = new Map<string, App>();
  /** the ports of the applications that run */
  const busy = new Set<number>();
  /** the processes of the applications that run, with their key, the ones that are told to end too */
  const started = new Map<ChildProcess, string>();
  let stopped = false;

  /** the processes that run, for the stats of the fronts, and for them to end should the primary be gone, which cannot end them then */
  const running = (): PrimaryMessage => ({
    nodeWebserver: 'apps',
    running: Array.from(started).flatMap(([{ pid }, key]) => (pid === undefined ? [] : [{ key, pid }])),
  });
  const tell = () => members.forEach(({ send }) => send(running()));

  const giveBack = ({ fixed, number }: App) => number !== undefined && !fixed && ports.give(number);

  const launch = (key: string, app: App, port: number, { command, args }: NonNullable<App['waiting']>) => {
    app.waiting = undefined;
    busy.add(port);
    const child = start(command, args, { stdio: 'pipe' });
    app.child = child;
    started.set(child, key);
    tell();
    // reads what it writes, which would otherwise fill the pipe, and logs why it could not be started
    setupChildListener(child, logger);
    child.once('close', () => {
      app.child = undefined;
      busy.delete(port);
      started.delete(child);
      tell();
      if (app.removed) giveBack(app);
      startWaiting();
    });
  };

  const startWaiting = () =>
    Array.from(apps).forEach(([key, app]) => {
      const { number, waiting } = app;
      if (!stopped && waiting && number !== undefined && !busy.has(number)) launch(key, app, number, waiting);
    });

  const remove = (key: string, app: App) => {
    apps.delete(key);
    app.removed = true;
    // the port is given back once nothing listens on it any more
    if (app.child) app.child.kill('SIGTERM');
    else giveBack(app);
    startWaiting();
  };

  /** stops what no front wants. Only once every front said what its servers are, as one that starts may want it, and not while there is none, as another one takes its place. */
  const prune = () => {
    const fronts = Array.from(members);
    if (fronts.length === 0 || fronts.some(({ serves }) => !serves)) return;

    Array.from(apps)
      .filter(([key]) => !fronts.some(({ holds }) => holds.has(key)))
      .forEach(([key, app]) => remove(key, app));
  };

  const create = (key: string, fixed: number | undefined, lookup?: PortLookup) => {
    const app: App = { port: fixed === undefined ? ports.take(lookup) : Promise.resolve(fixed), fixed: fixed !== undefined };
    apps.set(key, app);
    app.port.then(
      (number) => {
        app.number = number;
        if (app.removed) giveBack(app);
        else startWaiting();
      },
      (error) => {
        logger.error(`[${getDate()}] No port for an application:`, error);
        apps.delete(key);
      }
    );

    return app;
  };

  const claim = (member: Member, { key, port, lookup }: Extract<FrontServiceMessage, { nodeWebserver: 'app-claim' }>) => {
    member.holds.add(key);
    (apps.get(key) ?? create(key, port, lookup)).port.then(
      (number) => member.send({ nodeWebserver: 'app-port', key, port: number }),
      (error) => member.send({ nodeWebserver: 'app-port', key, error: String(error) })
    );
  };

  const order = ({ key, command, args }: Extract<FrontServiceMessage, { nodeWebserver: 'app-start' }>) => {
    const app = apps.get(key);
    if (!app || app.ordered) return;

    app.ordered = true;
    app.waiting = { command, args };
    startWaiting();
  };

  const receive = (member: Member, message: FrontServiceMessage) => {
    if (message.nodeWebserver === 'app-claim') return claim(member, message);
    if (message.nodeWebserver === 'app-start') return order(message);
    if (message.nodeWebserver !== 'app-release') return;

    member.holds.delete(message.key);
    prune();
  };

  return {
    join: (send) => {
      const member: Member = { send, holds: new Set() };
      members.add(member);

      return {
        hello: () => send(running()),
        receive: (message) => receive(member, message),
        serves: () => {
          member.serves = true;
          prune();
        },
        leave: () => {
          members.delete(member);
          prune();
        },
      };
    },
    /** ends all applications, for good */
    stop: () => {
      stopped = true;
      apps.forEach(({ child }) => child?.kill('SIGTERM'));
    },
  };
};

export default createAppRegistry;
