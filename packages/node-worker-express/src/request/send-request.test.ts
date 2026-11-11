import { Protocols, WORKER_EVENT, type RequestEvent, type WorkerLease } from '@koeroesi86/node-worker/pool';
import { EventEmitter } from 'events';
import type { Request } from 'express';
import sendRequest from './send-request';

const event = { protocol: Protocols.http, path: '/a' } as unknown as RequestEvent;

const setup = ({ allowed = false, inlineBody, streamsBody = false }: { allowed?: boolean; inlineBody?: Buffer; streamsBody?: boolean } = {}) => {
  const request = new EventEmitter();
  const lease = { send: jest.fn() };
  const requestHandOff = { isAllowed: jest.fn(() => allowed), start: jest.fn(() => Promise.resolve()) };
  const bodyForwarder = { part: jest.fn(), end: jest.fn() };

  sendRequest({
    request: request as unknown as Request,
    lease: lease as unknown as WorkerLease,
    requestId: 'r1',
    event,
    inlineBody,
    streamsBody,
    requestHandOff,
    bodyForwarder,
  });

  return { request, lease, requestHandOff, bodyForwarder };
};

describe('sendRequest', () => {
  it('sends the request as a message', () => {
    const { lease, requestHandOff } = setup();

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST, requestId: 'r1', event });
    expect(requestHandOff.start).not.toHaveBeenCalled();
  });

  it('sends a body that arrived with the request along with it', () => {
    const { lease } = setup({ inlineBody: Buffer.from('abc') });

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST, requestId: 'r1', event: { ...event, body: Buffer.from('abc') } });
  });

  it('forwards the parts of a streamed body and the end of it', () => {
    const { request, bodyForwarder } = setup({ streamsBody: true });
    request.emit('data', 'a');
    request.emit('end');

    expect(bodyForwarder.part).toHaveBeenCalledWith('a');
    expect(bodyForwarder.end).toHaveBeenCalledTimes(1);
  });

  it('listens to no body when none follows', () => {
    const { request } = setup();

    expect(request.listenerCount('data')).toBe(0);
  });

  it('hands the connection over instead when the request qualifies, and sends nothing', () => {
    const { lease, requestHandOff, request } = setup({ allowed: true, streamsBody: true });

    expect(requestHandOff.start).toHaveBeenCalledTimes(1);
    expect(lease.send).not.toHaveBeenCalled();
    expect(request.listenerCount('data')).toBe(0);
  });
});
