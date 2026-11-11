import type { IncomingMessage, ServerResponse } from 'http';
import writeTooLarge from './write-too-large';

const setup = () => {
  const request = { destroy: jest.fn() } as unknown as IncomingMessage;
  const finish: Array<() => void> = [];
  const response = {
    headersSent: false,
    writableEnded: false,
    setHeader: jest.fn(),
    once: jest.fn((_event: string, listener: () => void) => finish.push(listener)),
    writeHead: jest.fn(),
    end: jest.fn(),
  } as unknown as ServerResponse;

  return { request, response, finish };
};

describe('writeTooLarge', () => {
  it('answers 413 the way API Gateway does', () => {
    const { request, response } = setup();

    writeTooLarge(request, response);

    expect(response.writeHead).toHaveBeenCalledWith(413, { 'Content-Type': 'application/json' });
    expect(response.end).toHaveBeenCalledWith('{"message":"Request Entity Too Large"}');
  });

  it('closes the connection once the answer is out, as the rest of the body is not read', () => {
    const { request, response, finish } = setup();

    writeTooLarge(request, response);
    expect(response.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(request.destroy).not.toHaveBeenCalled();

    finish.forEach((listener) => listener());

    expect(request.destroy).toHaveBeenCalledTimes(1);
  });
});
