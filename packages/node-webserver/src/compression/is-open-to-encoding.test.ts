import isOpenToEncoding from './is-open-to-encoding';

describe('isOpenToEncoding', () => {
  it.each([
    ['a plain answer', 200, {}, true],
    ['an error page', 404, {}, true],
    ['an identity encoding', 200, { 'content-encoding': 'identity' }, true],
    ['a cache control without no-transform', 200, { 'cache-control': 'public, max-age=60' }, true],
    ['an informational status', 101, {}, false],
    ['no content', 204, {}, false],
    ['reset content', 205, {}, false],
    ['not modified', 304, {}, false],
    ['a part of an answer', 206, { 'content-range': 'bytes 0-9/100' }, false],
    ['an encoded answer', 200, { 'content-encoding': 'gzip' }, false],
    ['no-transform', 200, { 'cache-control': 'no-transform' }, false],
    ['no-transform among others', 200, { 'cache-control': ['public', 'No-Transform'] }, false],
  ])('%s', (_name, statusCode, headers, expected) => {
    expect(isOpenToEncoding(statusCode, headers)).toBe(expected);
  });
});
