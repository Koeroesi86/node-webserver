import { RoutePathLimit } from '../constants';
import createRouteMatcher from './create-route-matcher';

describe('createRouteMatcher', () => {
  it('finds the target of a path and of a pattern', () => {
    const match = createRouteMatcher([{ path: '/a' }, { pattern: '/b/[0-9]+' }], (_, position) => `target ${position}`);

    expect(match('/a')).toEqual({ target: 'target 0' });
    expect(match('/b/12')).toEqual({ target: 'target 1' });
    expect(match('/b/12/more')).toBeUndefined();
    expect(match('/c')).toBeUndefined();
  });

  it('takes the first route that matches, a path as well as a pattern', () => {
    const match = createRouteMatcher([{ pattern: '/a/.*' }, { path: '/a/1' }, { path: '/b' }, { pattern: '/b' }], (_, position) => position);

    expect(match('/a/1')?.target).toBe(0);
    expect(match('/b')?.target).toBe(2);
  });

  it('hands the named groups on, without the ones that took no part', () => {
    const match = createRouteMatcher([{ pattern: '/items/(?<id>[0-9]+)(?:/(?<part>[a-z]+))?' }, { pattern: '/plain' }], () => 'target');

    expect(match('/items/1/name')).toEqual({ target: 'target', pathParameters: { id: '1', part: 'name' } });
    expect(match('/items/1')).toEqual({ target: 'target', pathParameters: { id: '1' } });
    expect(match('/plain')).toEqual({ target: 'target' });
  });

  it('matches no path that is longer than the limit', () => {
    const match = createRouteMatcher([{ pattern: '/.*' }], () => 'target');

    expect(match(`/${'a'.repeat(RoutePathLimit - 1)}`)).toBeDefined();
    expect(match(`/${'a'.repeat(RoutePathLimit)}`)).toBeUndefined();
  });

  it('resolves the target of a route before it checks the route, in order', () => {
    const resolved: number[] = [];
    const resolveTarget = (_: unknown, position: number) => {
      resolved.push(position);
      if (position === 1) throw new Error('no target');
    };

    expect(() => createRouteMatcher([{ pattern: '/(' }, { path: '/a' }], resolveTarget)).toThrow(/pattern of routes\[0\] is not valid/);
    expect(resolved).toEqual([0]);
    expect(() => createRouteMatcher([{ path: '/a' }, { path: 'b' }], resolveTarget)).toThrow('no target');
  });
});
