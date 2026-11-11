import findPatternProblems from './find-pattern-problems';

describe('findPatternProblems', () => {
  it('finds nothing in valid patterns, nor in routes of a path', () => {
    expect(findPatternProblems('s', 'routes', [{ pattern: '/items/(?<id>[0-9]+)', flags: 'i' }, {}])).toEqual([]);
    expect(findPatternProblems('s', 'routes')).toEqual([]);
  });

  it('names the position of a pattern that is not a regular expression, and of flags that are not', () => {
    const problems = findPatternProblems('s', 'routes', [{ pattern: '/ok' }, { pattern: '/items/(' }, { pattern: '/ok', flags: 'z' }]);

    expect(problems.map(({ setting }) => setting)).toEqual(['routes[1].pattern', 'routes[2].pattern']);
    expect(problems[0].message).toContain('Invalid regular expression');
  });
});
