import type { Request } from 'express';
import { RequestBodyWindow, WORKER_EVENT } from '../constants';
import createBodyForwarder from './create-body-forwarder';
import type { WorkerLease } from './workerPool';

const setup = (limit?: number) => {
  const request = { pause: jest.fn(), resume: jest.fn() };
  const lease = { send: jest.fn() };
  const onTooBig = jest.fn();
  const onProgress = jest.fn();
  const forwarder = createBodyForwarder({
    request: request as unknown as Request,
    lease: lease as unknown as WorkerLease,
    requestId: 'r1',
    limit,
    onTooBig,
    onProgress,
  });

  return { request, lease, onTooBig, onProgress, forwarder };
};

describe('createBodyForwarder', () => {
  it('sends the parts to the worker and counts them as progress', () => {
    const { lease, onProgress, forwarder } = setup();

    forwarder.part(Buffer.from('ab'));

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST_BODY, requestId: 'r1', event: { body: Buffer.from('ab') } });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('ends the body with a part of null', () => {
    const { lease, forwarder } = setup();

    forwarder.end();

    expect(lease.send).toHaveBeenCalledWith({ type: WORKER_EVENT.REQUEST_BODY, requestId: 'r1', event: { body: null } });
  });

  it('pauses the request when the worker is a window behind, and resumes it when the worker takes a part', () => {
    const { request, forwarder } = setup();

    for (let part = 0; part < RequestBodyWindow; part += 1) forwarder.part(Buffer.from('x'));
    expect(request.pause).toHaveBeenCalledTimes(1);

    forwarder.acknowledge();
    expect(request.resume).toHaveBeenCalledTimes(1);
  });

  it('stops at a body above the limit without sending the part', () => {
    const { lease, onTooBig, forwarder } = setup(3);

    forwarder.part(Buffer.from('ab'));
    forwarder.part(Buffer.from('cd'));

    expect(onTooBig).toHaveBeenCalledTimes(1);
    expect(lease.send).toHaveBeenCalledTimes(1);
  });

  it('has no limit when it is 0', () => {
    const { onTooBig, forwarder } = setup(0);

    forwarder.part(Buffer.alloc(1000));

    expect(onTooBig).not.toHaveBeenCalled();
  });
});
