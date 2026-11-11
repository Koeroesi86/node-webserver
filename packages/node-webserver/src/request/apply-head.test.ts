import applyHead from './apply-head';

describe('applyHead', () => {
  it('replaces the given headers regardless of the case of the name', () => {
    expect(applyHead({ etag: '"a"', 'x-other': '1' }, { ETag: 'W/"a"' })).toEqual({ 'x-other': '1', ETag: 'W/"a"' });
  });

  it('removes the headers that are changed to undefined and does not write them', () => {
    expect(applyHead({ 'Content-Length': 10, a: 'b' }, { 'Content-Length': undefined })).toEqual({ a: 'b' });
  });

  it('writes the changes when nothing was given', () => {
    expect(applyHead(undefined, { Vary: 'Accept-Encoding' })).toEqual({ Vary: 'Accept-Encoding' });
  });
});
