import normalizeStaticOptions from './normalize-static-options';

describe('normalizeStaticOptions', () => {
  it('has everything off by default', () => {
    expect(normalizeStaticOptions()).toEqual({ cacheControl: [], listDirectories: false, precompressed: [] });
  });

  it('writes folders with slashes and extensions with a dot in lower case', () => {
    const { cacheControl } = normalizeStaticOptions({
      cacheControl: [
        { folder: 'assets', value: 'a' },
        { folder: '/img/x/', extension: 'PNG', value: 'b' },
        { folder: '/', value: 'c' },
        { extension: '.js', value: 'd' },
      ],
    });

    expect(cacheControl).toEqual([
      { folder: '/assets/', value: 'a' },
      { folder: '/img/x/', extension: '.png', value: 'b' },
      { folder: '/', value: 'c' },
      { extension: '.js', value: 'd' },
    ]);
  });

  it('is the same when it is normalized again', () => {
    const once = normalizeStaticOptions({ cacheControl: [{ folder: 'a', extension: 'JS', value: 'v' }], precompressed: ['br'] });

    expect(normalizeStaticOptions(once)).toEqual(once);
  });

  it.each([{ value: 'x' }, { folder: '/a/', value: '' }, { extension: 'js', value: '' }])('refuses the rule %j', (rule) => {
    expect(() => normalizeStaticOptions({ cacheControl: [rule] })).toThrow('A cache rule needs');
  });

  it('refuses an encoding it cannot look for', () => {
    expect(() => normalizeStaticOptions({ precompressed: ['br', 'deflate' as 'br'] })).toThrow('deflate');
  });
});
