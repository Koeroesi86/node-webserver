import { EventEmitter } from 'events';
import createConnectionHandover from './create-connection-handover';

describe('createConnectionHandover', () => {
  const HTTP = ':::80:6:undefined';
  const HTTPS = ':::443:6:undefined';

  const fake = (handOver: ReturnType<typeof createConnectionHandover>) => {
    const send = jest.fn<boolean, unknown[]>(() => true);
    const disconnect = jest.fn();
    const process = Object.assign(new EventEmitter(), { send, disconnect });
    const worker = { process, disconnect: jest.fn() };
    const answers = jest.fn();
    handOver(worker as never);
    process.on('internalMessage', answers);

    /** as cluster does when the front asks to listen */
    const listens = (key: string, errno: number | null = null) => process.send({ cmd: 'NODE_CLUSTER', errno, key, ack: 1, seq: 100 });
    /** as cluster does with a connection */
    const handed = (seq: number, key = HTTP) => process.send({ cmd: 'NODE_CLUSTER', act: 'newconn', key, seq });
    const says = (message: object) => process.emit('internalMessage', { cmd: 'NODE_CLUSTER', ...message });
    const ends = () => {
      process.disconnect();
      process.emit('close');
    };

    return { worker, process, send, disconnect, answers, listens, handed, says, ends };
  };

  const two = () => {
    const handOver = createConnectionHandover();
    const first = fake(handOver);
    const second = fake(handOver);
    [first, second].forEach(({ listens }) => listens(HTTP));
    return { first, second };
  };

  const answer = (ack: number, accepted: boolean) => [{ cmd: 'NODE_CLUSTER', ack, accepted }];

  it('sends what the primary sends, with all that comes with it', () => {
    const { process, send } = fake(createConnectionHandover());
    const handle = {};

    expect(process.send({ nodeWebserver: 'stop' }, handle)).toBe(true);
    expect(send).toHaveBeenCalledWith({ nodeWebserver: 'stop' }, handle);
  });

  it('refuses the connections a front did not answer once it ended, for another front to take them', () => {
    const { first } = two();
    first.handed(2);
    first.handed(3);

    first.ends();

    expect(first.answers.mock.calls).toEqual([answer(2, false), answer(3, false)]);
  });

  it('waits until the process of the front ended, as it may still have said that it took the connection', () => {
    const { first } = two();
    first.handed(2);

    first.process.disconnect();
    expect(first.answers).not.toHaveBeenCalled();

    first.says({ ack: 2, accepted: true });
    first.answers.mockClear();
    first.process.emit('close');

    expect(first.answers).not.toHaveBeenCalled();
  });

  it('leaves the connections a front answered to cluster', () => {
    const { first } = two();
    first.handed(2);
    first.says({ ack: 2, accepted: false });
    first.answers.mockClear();

    first.ends();

    expect(first.answers).not.toHaveBeenCalled();
  });

  it('takes the front out of cluster as soon as its channel closes, which cluster would otherwise do later or never', () => {
    const { first } = two();

    first.process.disconnect();

    expect(first.disconnect).toHaveBeenCalled();
    expect(first.worker.disconnect).toHaveBeenCalled();
    expect(first.disconnect.mock.invocationCallOrder[0]).toBeLessThan(first.worker.disconnect.mock.invocationCallOrder[0]);
  });

  it('has a connection closed when no other front listens on its port', () => {
    const { first, second } = two();
    first.listens(HTTPS);
    first.handed(2, HTTPS);
    second.says({ act: 'close', key: HTTP });
    first.handed(3);

    first.ends();

    expect(first.answers.mock.calls).toEqual([answer(2, true), answer(3, true)]);
  });

  it('does not count a front that cannot listen, or that cannot be reached any more', () => {
    const handOver = createConnectionHandover();
    const [first, failed, gone] = [fake(handOver), fake(handOver), fake(handOver)];
    first.listens(HTTP);
    failed.listens(HTTP, -98);
    gone.listens(HTTP);
    gone.ends();
    first.handed(2);

    first.ends();

    expect(first.answers.mock.calls).toEqual([answer(2, true)]);
  });

  it('ignores the messages that are not the ones of cluster', () => {
    const { first } = two();
    first.process.send(undefined);
    first.process.send({ cmd: 'NODE_HANDLE', key: HTTP, act: 'newconn', seq: 2 });
    first.handed(3);
    first.process.emit('internalMessage', { cmd: 'NODE_HANDLE_ACK', ack: 3 });
    first.answers.mockClear();

    first.ends();

    expect(first.answers.mock.calls).toEqual([answer(3, false)]);
  });
});
