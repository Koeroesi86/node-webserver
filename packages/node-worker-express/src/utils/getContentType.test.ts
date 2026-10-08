import getContentType from './getContentType';

describe('getContentType', () => {
  it.each([
    ['.html', 'text/html'],
    ['.css', 'text/css'],
    ['.js', 'text/javascript'],
    ['.json', 'application/json'],
    ['.png', 'image/png'],
    ['.woff2', 'font/woff2'],
    ['.svg', 'image/svg+xml'],
  ])('knows %s', (extension, contentType) => {
    expect(getContentType(extension)).toBe(contentType);
  });

  it('falls back to plain text for an unknown extension, and for none', () => {
    expect(getContentType('.unknown')).toBe('text/plain');
    expect(getContentType()).toBe('text/plain');
  });
});
