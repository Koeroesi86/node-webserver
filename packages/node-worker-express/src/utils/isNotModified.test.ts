import isNotModified from './isNotModified';

const modified = Date.UTC(2026, 0, 2, 3, 4, 5, 678);
const etag = 'W/"10-1a2b"';

describe('isNotModified', () => {
  it('is modified without conditional headers', () => {
    expect(isNotModified({}, etag, modified)).toBe(false);
  });

  it.each([
    ['the same validator', 'W/"10-1a2b"'],
    ['a strong form of it', '"10-1a2b"'],
    ['one of several', '"x", W/"10-1a2b" , "y"'],
    ['any', '*'],
  ])('is not modified for %s in If-None-Match', (_, header) => {
    expect(isNotModified({ 'if-none-match': header }, etag, modified)).toBe(true);
  });

  it('is modified for another validator', () => {
    expect(isNotModified({ 'if-none-match': '"other"' }, etag, modified)).toBe(false);
  });

  it('lets If-None-Match decide when If-Modified-Since says otherwise', () => {
    const headers = { 'if-none-match': '"other"', 'if-modified-since': new Date(modified).toUTCString() };

    expect(isNotModified(headers, etag, modified)).toBe(false);
  });

  it.each([
    ['the modification time, which has a resolution of seconds', new Date(modified).toUTCString(), true],
    ['a later time', new Date(modified + 60000).toUTCString(), true],
    ['an earlier time', new Date(modified - 60000).toUTCString(), false],
    ['something that is not a date', 'yesterday', false],
  ])('for If-Modified-Since with %s', (_, header, expected) => {
    expect(isNotModified({ 'if-modified-since': header }, etag, modified)).toBe(expected);
  });
});
