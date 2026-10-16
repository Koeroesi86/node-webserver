import lowerCaseHeaders from './lower-case-headers';

describe('lowerCaseHeaders', () => {
  it('lower cases the names and keeps the values', () => {
    expect(lowerCaseHeaders({ 'Content-Type': 'text/html', ETag: ['a'], vary: undefined })).toEqual({
      'content-type': 'text/html',
      etag: ['a'],
      vary: undefined,
    });
  });
});
