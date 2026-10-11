import net from 'net';
import createHandOffRequests from './create-hand-off-requests';

describe('createHandOffRequests', () => {
  const head = { statusCode: 200, headers: { 'Content-Length': '5' }, handOff: true } as const;
  const create = () => {
    const ask = jest.fn();
    return { ask, handOffs: createHandOffRequests(ask) };
  };

  it('asks the server and resolves with the connection that comes for the request', async () => {
    const { ask, handOffs } = create();
    const socket = new net.Socket();

    const taken = handOffs.request('a', false, head);
    handOffs.receive({ requestId: 'a' }, socket);

    expect(ask).toHaveBeenCalledWith('a', head);
    expect(await taken).toBe(socket);
  });

  it('resolves with nothing when the server refuses, and for a request that is aborted already without asking', async () => {
    const { ask, handOffs } = create();

    const refused = handOffs.request('a', false, head);
    handOffs.settle('a');

    expect(await refused).toBeUndefined();
    expect(await handOffs.request('b', true, head)).toBeUndefined();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('closes a connection that nobody waits for any more', () => {
    const { handOffs } = create();
    const socket = new net.Socket();
    const destroy = jest.spyOn(socket, 'destroy');

    handOffs.receive({ requestId: 'gone' }, socket);

    expect(destroy).toHaveBeenCalled();
  });

  it('ignores a message without a request or without a connection', async () => {
    const { handOffs } = create();
    const socket = new net.Socket();
    const destroy = jest.spyOn(socket, 'destroy');
    const taken = handOffs.request('a', false, head);

    handOffs.receive(undefined, socket);
    handOffs.receive(null, socket);
    handOffs.receive({ requestId: 1 }, socket);
    handOffs.receive({ requestId: 'a' }, undefined);
    handOffs.settle('a');

    expect(destroy).not.toHaveBeenCalled();
    expect(await taken).toBeUndefined();
  });

  it('closes a connection that takes nothing for the timeout of the message', () => {
    const { handOffs } = create();
    const socket = new net.Socket();
    const setTimeout = jest.spyOn(socket, 'setTimeout');
    handOffs.request('a', false, head);
    handOffs.request('b', false, head);

    handOffs.receive({ requestId: 'a', timeout: 100 }, socket);
    handOffs.receive({ requestId: 'b' }, new net.Socket());

    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(100, expect.any(Function));
  });
});
