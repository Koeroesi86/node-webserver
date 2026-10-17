import net from 'net';
import type { Response } from 'express';
import canKeepConnection from './can-keep-connection';

describe('canKeepConnection', () => {
  const listening = () => {
    const server = new net.Server();
    Object.defineProperty(server, 'listening', { get: () => true });

    return server;
  };
  const respondTo = (shouldKeepAlive: boolean, connection?: string) =>
    ({ shouldKeepAlive, getHeader: (name: string) => (name === 'connection' ? connection : undefined) }) as unknown as Response;

  it('keeps the connection of a client that wants it, on a server that accepts connections', () => {
    expect(canKeepConnection(respondTo(true), listening())).toBe(true);
  });

  it.each([
    ['a client that wants it closed', respondTo(false), listening()],
    ['a response that tells the client to move on', respondTo(true, 'Close'), listening()],
    ['a server that stopped accepting connections', respondTo(true), new net.Server()],
    ['a connection that no server accepted', respondTo(true), undefined],
  ])('closes it for %s', (_name, response, server) => {
    expect(canKeepConnection(response, server)).toBe(false);
  });
});
