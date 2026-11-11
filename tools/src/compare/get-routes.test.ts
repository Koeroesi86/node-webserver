import { summary } from '../test-helpers/summaries';
import { getRoutes } from './get-routes';

describe('getRoutes', () => {
  it('lists the routes that have a latency, once, in the order they are seen', () => {
    const summaries = [summary({ routes: { worker: 1, static: 2 } }), summary({ routes: { static: 2, secure: 3 } })];

    expect(getRoutes(summaries)).toEqual(['worker', 'static', 'secure']);
  });

  it('does not take the other metrics for routes', () => {
    expect(getRoutes([{ metrics: { http_reqs: { rate: 1 }, 'checks{route:worker}': { value: 1 } } }])).toEqual([]);
  });
});
