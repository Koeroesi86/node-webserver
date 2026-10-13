import closeWebSockets from './close-web-sockets';
import webSocketConnections from './web-socket-connections';

describe('closeWebSockets', () => {
  afterEach(() => webSocketConnections.clear());

  it('closes every connection that is open with going away', () => {
    const connections = [{ close: jest.fn() }, { close: jest.fn() }];
    connections.forEach((connection) => webSocketConnections.add(connection));

    closeWebSockets();

    connections.forEach((connection) => expect(connection.close).toHaveBeenCalledWith(1001, 'Going away.'));
  });

  it('takes the code and the reason', () => {
    const connection = { close: jest.fn() };
    webSocketConnections.add(connection);

    closeWebSockets(1012, 'Restart.');

    expect(connection.close).toHaveBeenCalledWith(1012, 'Restart.');
  });
});
