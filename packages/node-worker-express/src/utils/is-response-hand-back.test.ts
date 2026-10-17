import { WORKER_EVENT } from '../constants';
import isResponseHandBack from './is-response-hand-back';

describe('isResponseHandBack', () => {
  const message = { type: WORKER_EVENT.RESPONSE_HANDBACK, requestId: 'a', leftover: '' };

  it('accepts the message that gives a connection back after a response', () => {
    expect(isResponseHandBack(message)).toBe(true);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a text', 'hello'],
    ['the hand back of a request', { ...message, type: WORKER_EVENT.REQUEST_HANDBACK }],
    ['no request id', { ...message, requestId: 1 }],
    ['no leftover', { ...message, leftover: undefined }],
  ])('refuses %s', (_name, value) => {
    expect(isResponseHandBack(value)).toBe(false);
  });
});
