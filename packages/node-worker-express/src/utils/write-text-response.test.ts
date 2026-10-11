import type { Response } from 'express';
import writeTextResponse from './write-text-response';

describe('writeTextResponse', () => {
  it('answers with the status and the message as plain text', () => {
    const response = { writeHead: jest.fn(), end: jest.fn() };

    writeTextResponse(response as unknown as Response, 404, 'Not found.');

    expect(response.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
    expect(response.end).toHaveBeenCalledWith('Not found.');
  });

  it('adds the headers it is given', () => {
    const response = { writeHead: jest.fn(), end: jest.fn() };

    writeTextResponse(response as unknown as Response, 503, 'Too many connections.', { 'Retry-After': 1 });

    expect(response.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'text/plain', 'Retry-After': 1 });
  });
});
