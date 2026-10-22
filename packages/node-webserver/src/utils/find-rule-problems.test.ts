import findRuleProblems from './find-rule-problems';
import type { Rule } from '../types';

const find = (...rules: Rule[]) => findRuleProblems({ rules }, 's').map(({ severity, setting, message }) => `${severity} ${setting} ${message}`);

describe('findRuleProblems', () => {
  it('finds nothing in valid rules, nor without rules', () => {
    expect(findRuleProblems({}, 's')).toEqual([]);
    expect(
      find(
        { path: '/old', redirect: '/new', status: 301 },
        { pattern: '/(?<rest>.*)', redirect: 'https://example.com/{rest}', status: 308 },
        { pattern: '/app/.*', rewrite: '/index.html' },
        { pattern: '/v1/(?<rest>.*)', rewrite: '/api/{rest}' }
      )
    ).toEqual([]);
  });

  it('names the position of a pattern that is not a regular expression', () => {
    expect(find({ path: '/a', redirect: '/b', status: 301 }, { pattern: '/(', rewrite: '/b' })).toEqual([expect.stringContaining('error rules[1].pattern')]);
  });

  it('refuses a placeholder that is no named group of the pattern, and any in a rule of a path', () => {
    expect(find({ pattern: '/(?<id>[0-9]+)', redirect: '/x/{other}', status: 301 })).toEqual([expect.stringContaining('{other}')]);
    expect(find({ path: '/a', rewrite: '/{rest}' })).toEqual([expect.stringContaining('{rest}')]);
  });

  it.each(['//evil.com', '/\\evil.com', 'evil.com/path', 'https://{host}/x', 'https://example.com{rest}.evil.com', 'https://user@evil.com/'])(
    'refuses the redirect target %s, which can lead to a host of the request',
    (redirect) => {
      expect(find({ pattern: '/(?<host>.*)(?<rest>.*)', redirect, status: 301 })).not.toEqual([]);
    }
  );

  it('refuses a rewrite to another host or one that is not a path', () => {
    expect(find({ pattern: '/.*', rewrite: '//evil.com' }, { pattern: '/.*', rewrite: 'https://example.com/' })).toHaveLength(2);
  });

  it('warns about 301 and 302 for a method that is not GET or HEAD, and about no other status or method', () => {
    expect(find({ path: '/a', methods: ['POST'], redirect: '/b', status: 301 })).toEqual([expect.stringContaining('warning rules[0].status')]);
    expect(find({ path: '/a', methods: ['post'], redirect: '/b', status: 302 })).toHaveLength(1);
    expect(find({ path: '/a', methods: ['POST'], redirect: '/b', status: 308 })).toEqual([]);
    expect(find({ path: '/a', methods: ['get', 'HEAD'], redirect: '/b', status: 301 })).toEqual([]);
    expect(find({ path: '/a', redirect: '/b', status: 301 })).toEqual([]);
  });
});
