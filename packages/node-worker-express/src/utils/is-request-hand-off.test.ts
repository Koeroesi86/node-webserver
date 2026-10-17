import { WORKER_EVENT } from '../constants';
import isRequestHandOff from './is-request-hand-off';

describe('isRequestHandOff', () => {
  const message = { type: WORKER_EVENT.REQUEST_HANDOFF, requestId: 'a', event: {}, prefix: '', length: 1, timeout: 0, keepAlive: true };

  it('accepts the message that hands a request over', () => {
    expect(isRequestHandOff(message)).toBe(true);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a text', 'hello'],
    ['the hand over of a response', { ...message, type: WORKER_EVENT.RESPONSE_HANDOFF }],
    ['no request id', { ...message, requestId: 1 }],
    ['no request', { ...message, event: undefined }],
    ['no prefix', { ...message, prefix: 1 }],
    ['no length', { ...message, length: '1' }],
    ['no timeout', { ...message, timeout: undefined }],
    ['no word on keeping the connection', { ...message, keepAlive: undefined }],
  ])('refuses %s', (_name, value) => {
    expect(isRequestHandOff(value)).toBe(false);
  });
});
