import { Protocols, type RequestEvent } from '@koeroesi86/node-worker/pool';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import registerRequestListeners from './register-request-listeners';

const setup = ({ protocol = Protocols.http, streamsBody = false }: { protocol?: string; streamsBody?: boolean } = {}) => {
  const request = Object.assign(new EventEmitter(), { resume: jest.fn() });
  const response = new EventEmitter();
  const bodyForwarder = { part: jest.fn(), end: jest.fn() };
  const cleanup = jest.fn();
  const undo: Array<() => void> = [];

  registerRequestListeners({
    request: request as unknown as Request,
    response: response as unknown as Response,
    event: { protocol } as RequestEvent,
    streamsBody,
    bodyForwarder,
    cleanup,
    addUndo: (fn) => undo.push(fn),
  });

  return { request, response, bodyForwarder, cleanup, runUndo: () => undo.splice(0).forEach((fn) => fn()) };
};

describe('registerRequestListeners', () => {
  it('cleans up when the client aborts the request', () => {
    const { request, cleanup } = setup();

    request.emit('aborted');

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it.each(['close', 'finish'])('cleans up when the response of an http request emits %s', (name) => {
    const { response, cleanup } = setup();

    response.emit(name);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does not watch the response of a websocket request, its connection is the socket', () => {
    const { response, cleanup } = setup({ protocol: Protocols.websocket });

    response.emit('close');
    response.emit('finish');

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('stops listening to the request and to the close of the response when undone', () => {
    const { request, response, cleanup, runUndo } = setup();

    runUndo();
    request.emit('aborted');
    response.emit('close');

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('reads and drops what is left of a streamed body when undone', () => {
    const { request, bodyForwarder, runUndo } = setup({ streamsBody: true });
    request.on('data', bodyForwarder.part);
    request.on('end', bodyForwarder.end);

    runUndo();

    expect(request.listenerCount('data')).toBe(0);
    expect(request.listenerCount('end')).toBe(0);
    expect(request.resume).toHaveBeenCalledTimes(1);
  });

  it('leaves a request without a streamed body alone when undone', () => {
    const { request, runUndo } = setup();

    runUndo();

    expect(request.resume).not.toHaveBeenCalled();
  });
});
