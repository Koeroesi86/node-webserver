import isInside from './isInside';

describe('isInside', () => {
  it.each([
    ['/root', '/root', true],
    ['/root', '/root/a/b.txt', true],
    ['/root', '/root/a/../b.txt', true],
    ['/root', '/root/..', false],
    ['/root', '/root/../other', false],
    ['/root', '/rootother/file', false],
    ['/root', '/', false],
  ])('%s contains %s: %s', (folder, target, expected) => {
    expect(isInside(folder, target)).toBe(expected);
  });
});
