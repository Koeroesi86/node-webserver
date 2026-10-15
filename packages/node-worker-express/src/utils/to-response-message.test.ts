import toResponseMessage from './to-response-message';

const head = { statusCode: 200, headers: {} };

describe('toResponseMessage', () => {
  it('sends a text body as bytes', () => {
    expect(toResponseMessage({ ...head, body: 'aé', isBase64Encoded: false }).body).toEqual(Buffer.from('aé'));
  });

  it('decodes a base64 body', () => {
    expect(toResponseMessage({ ...head, body: 'YWI=', isBase64Encoded: true }).body).toEqual(Buffer.from('ab'));
  });

  it('keeps the end of a stream, drops the encoding flag and keeps the rest', () => {
    const message = toResponseMessage({ ...head, body: null, isBase64Encoded: false, emit: true });

    expect(message).toEqual({ ...head, body: null, emit: true });
  });
});
