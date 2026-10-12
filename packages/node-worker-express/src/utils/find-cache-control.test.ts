import findCacheControl from './find-cache-control';

describe('findCacheControl', () => {
  const rules = [
    { folder: '/assets/', extension: '.js', value: 'long' },
    { extension: '.css', value: 'css' },
    { folder: '/assets/', value: 'folder' },
  ];

  it.each([
    ['/assets/app.js', 'long'],
    ['/assets/APP.JS', 'long'],
    ['/assets/app.css', 'css'],
    ['/assets/logo.png', 'folder'],
    ['/other/app.js', 'public, max-age=0'],
    ['/assetsx/logo.png', 'public, max-age=0'],
  ])('uses the first matching rule for %s', (requestPath, expected) => {
    expect(findCacheControl(rules, requestPath)).toBe(expected);
  });
});
