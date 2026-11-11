import type { IncomingMessage, ServerResponse } from 'http';
import { MESSAGE_PAYLOAD_TOO_LARGE } from '../constants';
import writeError from './write-error';

/** answers 413, and closes the connection once the answer is out, as the rest of the body is not read */
const writeTooLarge = (request: IncomingMessage, response: ServerResponse) => {
  response.setHeader('Connection', 'close');
  response.once('finish', () => request.destroy());
  writeError(response, 413, MESSAGE_PAYLOAD_TOO_LARGE);
};

export default writeTooLarge;
