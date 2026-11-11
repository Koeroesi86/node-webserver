import toStringHeaders from './to-string-headers';

describe('toStringHeaders', () => {
  it('passes the headers of a request on as they are', () => {
    const headers = { host: 'localhost', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' };

    expect(toStringHeaders(headers)).toBe(headers);
  });

  it('joins a header that has several values', () => {
    expect(toStringHeaders({ host: 'localhost', 'set-cookie': ['a=1', 'b=2'] })).toEqual({ host: 'localhost', 'set-cookie': 'a=1, b=2' });
  });

  it('leaves out a header without a value', () => {
    expect(toStringHeaders({ host: 'localhost', accept: undefined })).toEqual({ host: 'localhost' });
  });
});
