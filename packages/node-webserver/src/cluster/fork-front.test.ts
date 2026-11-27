import cluster from 'cluster';
import { EventEmitter } from 'events';
import forkFront from './fork-front';
import { FRONT_PROCESS_ENV } from '../constants';

jest.mock('cluster', () => ({ __esModule: true, default: { fork: jest.fn() } }));

describe('forkFront', () => {
  const fake = ({ connected = true, started = true } = {}) => {
    const process = Object.assign(new EventEmitter(), { pid: started ? 5 : undefined, kill: jest.fn(), send: jest.fn(), disconnect: jest.fn() });
    const worker = Object.assign(new EventEmitter(), { process, send: jest.fn(), disconnect: jest.fn(), isConnected: () => connected });
    jest.mocked(cluster.fork).mockReturnValue(worker as never);
    return { worker, handle: forkFront({ index: 1, count: 2 }) };
  };

  it('tells the process its place in the environment', () => {
    const { handle } = fake();

    expect(cluster.fork).toHaveBeenCalledWith({ [FRONT_PROCESS_ENV]: '{"index":1,"count":2}' });
    expect(handle.pid).toBe(5);
  });

  it('sends the messages to a front that is connected only', () => {
    const connected = fake();
    connected.handle.send({ nodeWebserver: 'stop' });
    const gone = fake({ connected: false });
    gone.handle.send({ nodeWebserver: 'stop' });

    expect(connected.worker.send).toHaveBeenCalledWith({ nodeWebserver: 'stop' }, expect.any(Function));
    expect(gone.worker.send).not.toHaveBeenCalled();
  });

  it('answers for a front that ends with a connection it was handed', () => {
    const { worker } = fake();
    const answers = jest.fn();
    worker.process.on('internalMessage', answers);
    worker.process.send({ cmd: 'NODE_CLUSTER', act: 'newconn', key: ':::80', seq: 2 });

    worker.process.emit('close');

    expect(answers).toHaveBeenCalledWith({ cmd: 'NODE_CLUSTER', ack: 2, accepted: true });
  });

  it('kills the process', () => {
    const { worker, handle } = fake();

    handle.kill();

    expect(worker.process.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('passes the messages and the exit on', () => {
    const { worker, handle } = fake();
    const message = jest.fn();
    const exit = jest.fn();
    handle.onMessage(message);
    handle.onExit(exit);

    worker.emit('message', 'a');
    worker.emit('exit', 1, null);
    worker.emit('error', new Error('closed'));

    expect(message).toHaveBeenCalledWith('a');
    expect(exit.mock.calls).toEqual([[1, null]]);
  });

  it('takes a process that could not be started as ended', () => {
    const { worker, handle } = fake({ started: false });
    const exit = jest.fn();
    handle.onExit(exit);

    worker.emit('error', new Error('spawn EAGAIN'));

    expect(exit).toHaveBeenCalledWith(null, 'a failure to start');
  });
});
