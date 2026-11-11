import { ServerResponse, IncomingMessage } from 'http';
import { Socket } from 'net';
import writeError from './write-error';

const createResponse = () => new ServerResponse(new IncomingMessage(new Socket()));

describe('writeError', () => {
  it('answers with a JSON message, as API Gateway does', () => {
    const response = createResponse();
    const writeHead = jest.spyOn(response, 'writeHead');
    const end = jest.spyOn(response, 'end');

    writeError(response, 502, 'Internal server error');

    expect(writeHead).toHaveBeenCalledWith(502, { 'Content-Type': 'application/json' });
    expect(end).toHaveBeenCalledWith('{"message":"Internal server error"}');
  });

  it('leaves a response alone that was started already', () => {
    const response = createResponse();
    response.writeHead(200);
    response.write('x');
    const end = jest.spyOn(response, 'end');

    writeError(response, 502, 'Internal server error');

    expect(response.statusCode).toBe(200);
    expect(end).not.toHaveBeenCalled();
  });
});
