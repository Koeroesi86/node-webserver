import { EventEmitter } from 'events';
import createAppRegistry from './create-app-registry';
import createMockLogger from '../observability/mock-logger.test-helper';

const settle = () => new Promise(process.nextTick);

describe('createAppRegistry', () => {
  const logger = createMockLogger();
  const report = { targets: [], certificates: [] };
  const run = { nodeWebserver: 'app-start' as const, key: 'a', hostname: 'a.localhost', command: 'node', args: ['app.js', '4000'] };
  const claim = { nodeWebserver: 'app-claim' as const, key: 'a' };
  const release = { nodeWebserver: 'app-release' as const, key: 'a' };

  const create = () => {
    const children: Array<EventEmitter & { pid: number; kill: jest.Mock; stdout: EventEmitter; stderr: EventEmitter }> = [];
    const start = jest.fn(() => {
      const child = Object.assign(new EventEmitter(), { pid: 100 + children.length, kill: jest.fn(), stdout: new EventEmitter(), stderr: new EventEmitter() });
      children.push(child);
      return child;
    });
    let next = 4000;
    const ports = { take: jest.fn(async () => next++), give: jest.fn() };
    const registry = createAppRegistry(logger, { ports, start: start as never });
    const join = () => {
      const send = jest.fn();
      return { send, ...registry.join(send) };
    };
    return { registry, children, start, ports, join };
  };

  beforeEach(() => jest.clearAllMocks());

  it('starts an application once for the fronts that want it, and tells each one the port', async () => {
    const { start, join, ports } = create();
    const fronts = [join(), join()];

    for (const front of fronts) {
      front.receive({ ...claim, lookup: { from: 1, to: 2, address: 'localhost' } });
      await settle();
      front.receive(run);
    }

    const port = { nodeWebserver: 'app-port', key: 'a', port: 4000 };
    expect(fronts.map(({ send }) => send.mock.calls.filter(([{ nodeWebserver }]) => nodeWebserver === 'app-port'))).toEqual(Array(2).fill([[port]]));
    expect(ports.take).toHaveBeenCalledTimes(1);
    expect(start.mock.calls).toEqual([['node', ['app.js', '4000'], { stdio: 'pipe' }]]);
  });

  it('tells the fronts the processes that run, a front that comes later too', async () => {
    const { children, join } = create();
    const front = join();
    front.receive(claim);
    await settle();

    front.receive(run);
    const late = join();
    late.hello();
    children[0].emit('close');

    const running = { nodeWebserver: 'apps', running: [{ key: 'a', pid: 100 }] };
    expect(front.send).toHaveBeenCalledWith(running);
    expect(late.send.mock.calls).toEqual([[running], [{ nodeWebserver: 'apps', running: [] }]]);
  });

  it('logs what the application writes, and why it could not be started', async () => {
    const { children, join } = create();
    const front = join();
    front.receive(claim);
    await settle();
    front.receive(run);

    children[0].stdout.emit('data', 'listening\n');
    children[0].emit('error', new Error('no such command'));

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[a.localhost] listening'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('could not be started'), expect.anything());
  });

  it('logs what starting an application throws, and gives its port back once no front wants it', async () => {
    const { start, join, ports } = create();
    const error = new Error('spawn ENOTDIR');
    start.mockImplementationOnce(() => {
      throw error;
    });
    const front = join();
    front.serves(report);
    front.receive(claim);
    await settle();

    front.receive(run);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[a.localhost] node could not be started'), error);
    expect(ports.give).not.toHaveBeenCalled();
    front.receive(release);

    expect(ports.give).toHaveBeenCalledWith(4000);
  });

  it('starts the application that waits for the port of one whose start throws', async () => {
    const { children, start, join } = create();
    start.mockImplementationOnce(() => {
      throw new Error('spawn ENOTDIR');
    });
    const front = join();
    front.receive({ ...claim, port: 8080 });
    front.receive({ ...claim, key: 'b', port: 8080 });
    await settle();

    front.receive(run);
    front.receive({ ...run, key: 'b' });
    front.hello();

    expect(children).toHaveLength(1);
    expect(front.send).toHaveBeenLastCalledWith({ nodeWebserver: 'apps', running: [{ key: 'b', pid: 100 }] });
  });

  it('stops an application once no front wants it, and gives its port back once it ended', async () => {
    const { children, join, ports } = create();
    const fronts = [join(), join()];
    fronts.forEach((front) => front.receive(claim));
    await settle();
    fronts[0].receive(run);
    fronts.forEach((front) => front.serves(report));

    fronts[0].receive(release);
    expect(children[0].kill).not.toHaveBeenCalled();
    fronts[1].receive(release);

    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(ports.give).not.toHaveBeenCalled();
    children[0].emit('close');
    expect(ports.give).toHaveBeenCalledWith(4000);
  });

  it('keeps an application while a front that starts has not said what it serves, and while another one takes the place of the only front', async () => {
    const { children, join } = create();
    const first = join();
    first.receive(claim);
    await settle();
    first.receive(run);
    first.serves(report);

    first.leave();
    const next = join();
    next.receive(claim);
    next.serves(report);
    expect(children[0].kill).not.toHaveBeenCalled();

    const starting = join();
    next.receive(release);
    expect(children[0].kill).not.toHaveBeenCalled();
    starting.serves(report);
    expect(children[0].kill).toHaveBeenCalled();
  });

  it('starts an application on a port of the configuration only once the one that had it ended', async () => {
    const { children, start, join, ports } = create();
    const front = join();
    front.serves(report);
    front.receive({ ...claim, port: 8080 });
    await settle();
    front.receive(run);

    front.receive({ ...claim, key: 'b', port: 8080 });
    await settle();
    front.receive({ ...run, key: 'b' });
    expect(start).toHaveBeenCalledTimes(1);
    front.receive(release);
    children[0].emit('close');

    expect(start).toHaveBeenCalledTimes(2);
    expect(front.send).toHaveBeenCalledWith({ nodeWebserver: 'app-port', key: 'b', port: 8080 });
    expect(ports.take).not.toHaveBeenCalled();
    expect(ports.give).not.toHaveBeenCalled();
  });

  it('does not give the port of an application that ended on its own to another one', async () => {
    const { children, join, ports } = create();
    const front = join();
    front.receive(claim);
    await settle();
    front.receive(run);

    children[0].emit('close');

    expect(ports.give).not.toHaveBeenCalled();
  });

  it('tells the front why it has no port, and tries again for the next one', async () => {
    const { join, ports } = create();
    ports.take.mockRejectedValueOnce(new Error('No more available port left.'));
    const front = join();

    front.receive(claim);
    await settle();
    expect(front.send).toHaveBeenCalledWith({ nodeWebserver: 'app-port', key: 'a', error: 'Error: No more available port left.' });
    front.receive(claim);
    await settle();

    expect(front.send).toHaveBeenLastCalledWith({ nodeWebserver: 'app-port', key: 'a', port: 4000 });
  });

  it('ends all applications when it is stopped, and starts none after', async () => {
    const { registry, children, start, join } = create();
    const front = join();
    front.receive(claim);
    await settle();
    front.receive(run);

    registry.stop();
    front.receive({ ...claim, key: 'b' });
    await settle();
    front.receive({ ...run, key: 'b' });

    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(start).toHaveBeenCalledTimes(1);
  });
});
