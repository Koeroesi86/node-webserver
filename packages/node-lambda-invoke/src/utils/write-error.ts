import type { ServerResponse } from 'http';

/** answers the way API Gateway does when the integration fails: a JSON object with a message */
const writeError = (response: ServerResponse, statusCode: number, message: string) => {
  if (response.headersSent || response.writableEnded) return;

  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ message }));
};

export default writeError;
