import { fork } from 'child_process';
import { EventEmitter } from 'events';
import forkServer from './fork-server';
import { LAUNCHER_ENV } from '../constants';

jest.mock('child_process', () => ({ fork: jest.fn() }));

describe('forkServer', () => {
  const start = ({ connected = true, started = true } = {}) => {
    const child = Object.assign(new EventEmitter(), { pid: started ? 9 : undefined, connected, send: jest.fn() });
    jest.mocked(fork).mockReturnValue(child as never);
    return { child, server: forkServer('restart') };
  };

  it('starts this script again with its arguments, and tells it how it was started', () => {
    const { server } = start();

    expect(fork).toHaveBeenCalledWith(process.argv[1], process.argv.slice(2), {
      env: expect.objectContaining({ [LAUNCHER_ENV]: 'restart' }),
    });
    expect(server.pid).toBe(9);
  });

  it('sends to a server that is connected only', () => {
    const connected = start();
    connected.server.send({ nodeWebserver: 'signal', signal: 'SIGTERM' });
    const gone = start({ connected: false });
    gone.server.send({ nodeWebserver: 'signal', signal: 'SIGTERM' });

    expect(connected.child.send).toHaveBeenCalledTimes(1);
    expect(gone.child.send).not.toHaveBeenCalled();
  });

  it('passes the messages and the exit on', () => {
    const { child, server } = start();
    const message = jest.fn();
    const exit = jest.fn();
    server.onMessage(message);
    server.onExit(exit);

    child.emit('message', 'a');
    child.emit('exit', 75, null);
    child.emit('error', new Error('closed'));

    expect(message).toHaveBeenCalledWith('a');
    expect(exit.mock.calls).toEqual([[75, null]]);
  });

  it('takes a process that could not be started as ended with an error', () => {
    const { child, server } = start({ started: false });
    const exit = jest.fn();
    server.onExit(exit);

    child.emit('error', new Error('spawn EAGAIN'));

    expect(exit).toHaveBeenCalledWith(1, null);
  });

  it('starts the script it is given', () => {
    start();

    forkServer('start', '/app/current/cli.js');

    expect(fork).toHaveBeenLastCalledWith('/app/current/cli.js', process.argv.slice(2), expect.anything());
  });
});
