import { EventEmitter } from 'events';
import createLauncher from './create-launcher';
import { RESTART_EXIT_CODE } from '../constants';
import type { LauncherMode } from '../types';

describe('createLauncher', () => {
  const log = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => jest.useRealTimers());

  const create = () => {
    const target = Object.assign(new EventEmitter(), { kill: jest.fn(), exit: jest.fn(), pid: 3 });
    const servers: Array<{
      mode: LauncherMode;
      send: jest.Mock;
      say: (message: unknown) => void;
      exit: (code: number | null, signal?: string) => void;
    }> = [];
    const fork = (mode: LauncherMode) => {
      let say: (message: unknown) => void = () => {};
      let exit: (code: number | null, signal: string | null) => void = () => {};
      const send = jest.fn();
      servers.push({ mode, send, say: (message) => say(message), exit: (code, signal) => exit(code, signal ?? null) });
      return {
        pid: 10 + servers.length,
        send,
        onMessage: (listener: (message: unknown) => void) => (say = listener),
        onExit: (listener: (code: number | null, signal: string | null) => void) => (exit = listener),
      };
    };
    createLauncher({ fork, log, target: target as unknown as NodeJS.Process }).start();
    const signal = (name: string) => target.emit(name, name);
    const started = (index = 0) => {
      servers[index].say({ nodeWebserver: 'hello' });
      servers[index].say({ nodeWebserver: 'serving' });
    };

    return { target, servers, signal, started };
  };

  it('starts the server', () => {
    expect(create().servers.map(({ mode }) => mode)).toEqual(['start']);
  });

  it('starts the server again when it ends with the exit code for that', () => {
    const { target, servers, started } = create();
    started();

    servers[0].exit(RESTART_EXIT_CODE);

    expect(servers.map(({ mode }) => mode)).toEqual(['start', 'restart']);
    expect(target.exit).not.toHaveBeenCalled();
  });

  it.each([[0], [1]])('ends with the exit code %i of the server', (code) => {
    const { target, servers, started } = create();
    started();

    servers[0].exit(code);

    expect(target.exit).toHaveBeenCalledWith(code);
    expect(servers).toHaveLength(1);
  });

  it('ends with the signal that ended the server, which it does not catch any more', () => {
    const { target, servers, started } = create();
    started();

    servers[0].exit(null, 'SIGKILL');

    expect(target.kill).toHaveBeenCalledWith(3, 'SIGKILL');
    expect(target.listenerCount('SIGTERM')).toBe(0);
  });

  it('ends when the first start of the server fails', () => {
    const { target, servers } = create();

    servers[0].exit(1);

    expect(target.exit).toHaveBeenCalledWith(1);
    expect(servers).toHaveLength(1);
  });

  it('tries a start after a restart again, with a delay that grows, until the server serves', () => {
    const { target, servers, started } = create();
    started();
    servers[0].exit(RESTART_EXIT_CODE);

    servers[1].exit(1);
    jest.advanceTimersByTime(0);
    servers[2].exit(1);
    jest.advanceTimersByTime(99);
    expect(servers).toHaveLength(3);
    jest.advanceTimersByTime(1);
    started(3);
    servers[3].exit(1);

    expect(servers).toHaveLength(4);
    expect(target.exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('trying again in 100 ms'));
  });

  it('passes the signals on once the server listens for them', () => {
    const { servers, signal } = create();

    signal('SIGHUP');
    expect(servers[0].send).not.toHaveBeenCalled();
    servers[0].say({ nodeWebserver: 'hello' });
    signal('SIGTERM');

    expect(servers[0].send.mock.calls).toEqual([[{ nodeWebserver: 'signal', signal: 'SIGHUP' }], [{ nodeWebserver: 'signal', signal: 'SIGTERM' }]]);
  });

  it('does not start the server again once it was told to stop, and ends with that signal', () => {
    const { target, servers, signal, started } = create();
    started();

    signal('SIGTERM');
    servers[0].exit(RESTART_EXIT_CODE);

    expect(servers).toHaveLength(1);
    expect(target.kill).toHaveBeenCalledWith(3, 'SIGTERM');
  });

  it('stops while it waits to try again, and ignores a reload then', () => {
    const { target, servers, signal, started } = create();
    started();
    servers[0].exit(RESTART_EXIT_CODE);
    servers[1].exit(1);
    jest.advanceTimersByTime(0);
    servers[2].exit(1);

    signal('SIGHUP');
    expect(target.kill).not.toHaveBeenCalled();
    signal('SIGINT');
    jest.runAllTimers();

    expect(target.kill).toHaveBeenCalledWith(3, 'SIGINT');
    expect(servers).toHaveLength(3);
  });
});
