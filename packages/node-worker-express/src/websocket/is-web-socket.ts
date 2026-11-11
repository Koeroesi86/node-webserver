import { Request } from 'express';

const isWebSocket = (request: Request) => {
  const connection = request.headers.connection || '';
  const upgrade = request.headers.upgrade || '';

  return (
    request.method === 'GET' &&
    upgrade.toLowerCase() === 'websocket' &&
    connection
      .toLowerCase()
      .split(',')
      .some((token) => token.trim() === 'upgrade')
  );
};

export default isWebSocket;
