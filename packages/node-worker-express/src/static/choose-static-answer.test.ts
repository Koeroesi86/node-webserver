import type { Stats } from 'fs';
import chooseStaticAnswer from './choose-static-answer';

const stats = { size: 10, mtimeMs: Date.UTC(2026, 0, 2, 3, 4, 5) } as Stats;
const etag = 'W/"a-b"';

describe('chooseStaticAnswer', () => {
  it('sends the whole file by default', () => {
    expect(chooseStaticAnswer({}, etag, stats)).toEqual({ statusCode: 200, headers: { 'Content-Length': '10' }, hasBody: true });
  });

  it('answers 304 without a body, before the range', () => {
    expect(chooseStaticAnswer({ 'if-none-match': etag, range: 'bytes=0-1' }, etag, stats)).toEqual({ statusCode: 304, headers: {}, hasBody: false });
  });

  it('answers a range with 206', () => {
    expect(chooseStaticAnswer({ range: 'bytes=2-4' }, etag, stats)).toEqual({
      statusCode: 206,
      headers: { 'Content-Range': 'bytes 2-4/10', 'Content-Length': '3' },
      range: { start: 2, end: 4 },
      hasBody: true,
    });
  });

  it('answers a range outside of the file with 416', () => {
    expect(chooseStaticAnswer({ range: 'bytes=10-' }, etag, stats)).toEqual({
      statusCode: 416,
      headers: { 'Content-Range': 'bytes */10', 'Content-Length': '0' },
      hasBody: false,
    });
  });

  it('sends the whole file when If-Range is another one', () => {
    expect(chooseStaticAnswer({ range: 'bytes=2-4', 'if-range': '"other"' }, etag, stats).statusCode).toBe(200);
  });
});
