import { WORKER_EVENT } from '../constants';
import isRequestHandBack from './is-request-hand-back';

describe('isRequestHandBack', () => {
  const message = { type: WORKER_EVENT.REQUEST_HANDBACK, requestId: 'a', event: { statusCode: 200 }, leftover: '' };

  it('accepts the message that gives a connection back', () => {
    expect(isRequestHandBack(message)).toBe(true);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a text', 'hello'],
    ['the hand over of a request', { ...message, type: WORKER_EVENT.REQUEST_HANDOFF }],
    ['no request id', { ...message, requestId: 1 }],
    ['no summary', { ...message, event: undefined }],
    ['no leftover', { ...message, leftover: undefined }],
  ])('refuses %s', (_name, value) => {
    expect(isRequestHandBack(value)).toBe(false);
  });
});
