import type { WarmUpResult } from '../types/warm-up';
import { describeUnevenlyServed } from './describe-unevenly-served';

describe('describeUnevenlyServed', () => {
  const web = { host: 'web.localhost', path: '/' };
  const binary = { host: 'web.localhost', path: '/binary/?size=1' };
  const answered = (endpoint = web, status = 200): WarmUpResult => ({ endpoint, ready: true, status });

  it('is empty when the sides answer alike', () => {
    expect(describeUnevenlyServed([answered(), answered(binary)], [answered(), answered(binary)])).toBe('');
  });

  it('names the endpoints that the sides answer differently', () => {
    expect(describeUnevenlyServed([answered(), answered(binary, 404)], [answered(), answered(binary)])).toBe(
      '- `web.localhost/binary/?size=1`: 404 on the base, 200 on the pull request'
    );
  });

  it('tells an endpoint that did not answer on one side', () => {
    expect(describeUnevenlyServed([{ endpoint: web, ready: false }], [answered()])).toBe('- `web.localhost/`: no answer on the base, 200 on the pull request');
  });

  it('leaves out an endpoint that the base was not asked about', () => {
    expect(describeUnevenlyServed([], [answered()])).toBe('- `web.localhost/`: no answer on the base, 200 on the pull request');
  });
});
