import { Readable } from 'stream';
import createWorkerEvent from './create-worker-event';

const request = { path: '/' } as Parameters<typeof createWorkerEvent>[0];

describe('createWorkerEvent', () => {
  it('adds the body stream and the metrics to the request', () => {
    const bodyStream = new Readable();
    const getMetrics = jest.fn();

    const event = createWorkerEvent(request, 'r1', bodyStream, getMetrics);

    expect(event).toMatchObject({ path: '/', requestId: 'r1', bodyStream, getMetrics });
    expect('inlineBody' in event).toBe(false);
  });

  it('encodes the body that came with the request only when it is read', () => {
    const body = Buffer.from('ab');
    const toString = jest.spyOn(body, 'toString');

    const event = createWorkerEvent(request, 'r1', new Readable(), jest.fn(), body);
    expect(toString).not.toHaveBeenCalled();

    expect(Object.keys(event)).toContain('inlineBody');
    expect(event).toHaveProperty('inlineBody', 'YWI=');
  });
});
