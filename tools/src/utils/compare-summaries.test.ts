import { binaryRuns, binarySummary, cpuRuns, cpuSummary, runs, same } from '../test-helpers/summaries';
import type { K6Summary } from '../types/k6-summary';
import { compareSummaries } from './compare-summaries';

describe('compareSummaries', () => {
  describe('with the same results on both sides', () => {
    it('finds no regression', () => {
      const { regressions, markdown } = compareSummaries(same(), same());

      expect(regressions).toEqual([]);
      expect(markdown).toContain('✅ no regression');
      expect(markdown).toContain('| Throughput (req/s) | 4000 (4000-4000) | 4000 (4000-4000) | +0.0% | ✅ |');
    });

    it('lists a row for every route of the pull request, and the figures that are not judged', () => {
      const { markdown } = compareSummaries(same(), same());

      expect(markdown).toContain('| p95 worker (ms) | 6.0 | 6.0 | +0.0% | ✅ |');
      expect(markdown).toContain('| p95 static (ms) | 7.0 | 7.0 | +0.0% | ✅ |');
      expect(markdown).toContain('| p95 of all requests (ms) | 8.0 | 8.0 | +0.0% | ➖ |');
      expect(markdown).toContain('| WebSocket connect p95 (ms) | 100.0 | 100.0 | +0.0% | ➖ |');
    });
  });

  describe('throughput', () => {
    it('is a regression when it is more than 15% lower', () => {
      const { regressions, markdown } = compareSummaries(same(3, { rate: 4000 }), same(3, { rate: 3300 }));

      expect(regressions).toEqual([expect.stringContaining('Throughput is 17.5% lower')]);
      expect(markdown).toContain('❌ regression');
      expect(markdown).toContain('| Throughput (req/s) | 4000 (4000-4000) | 3300 (3300-3300) | −17.5% | ❌ |');
    });

    it('is not when it is 10% lower', () => {
      expect(compareSummaries(same(3, { rate: 4000 }), same(3, { rate: 3600 })).regressions).toEqual([]);
    });

    it('is not when it is higher', () => {
      expect(compareSummaries(same(3, { rate: 4000 }), same(3, { rate: 6000 })).regressions).toEqual([]);
    });

    it('is judged with the limit that is given', () => {
      expect(compareSummaries(same(3, { rate: 4000 }), same(3, { rate: 3600 }), { maxThroughputDrop: 0.05 }).regressions).toHaveLength(1);
    });
  });

  describe('latency of a route', () => {
    const withWorker = (p95: number) => same(3, { routes: { worker: p95, static: 7 } });

    it('is a regression when the p95 is more than 50% and 5 ms higher', () => {
      const { regressions, markdown } = compareSummaries(withWorker(10), withWorker(20));

      expect(regressions).toEqual([expect.stringContaining('The p95 of worker is 100.0% higher than the base (10.0 ms to 20.0 ms)')]);
      expect(markdown).toContain('| p95 worker (ms) | 10.0 | 20.0 | +100.0% | ❌ |');
    });

    it('is not when it is 40% higher', () => {
      expect(compareSummaries(withWorker(10), withWorker(14)).regressions).toEqual([]);
    });

    it('is not when it is many milliseconds higher but less than 50%, as a slow route varies more', () => {
      expect(compareSummaries(withWorker(100), withWorker(140)).regressions).toEqual([]);
    });

    it('is not when it is higher by a lot, but by less than 5 ms, as that is noise', () => {
      expect(compareSummaries(withWorker(2), withWorker(6)).regressions).toEqual([]);
    });

    it('is not when it is lower', () => {
      expect(compareSummaries(withWorker(10), withWorker(5)).regressions).toEqual([]);
    });

    it('names every route that got slower', () => {
      const { regressions } = compareSummaries(same(3, { routes: { worker: 10, static: 10 } }), same(3, { routes: { worker: 20, static: 30 } }));

      expect(regressions.map((regression) => regression.match(/p95 of (\w+)/)?.[1])).toEqual(['worker', 'static']);
    });
  });

  describe('routes that the base does not have', () => {
    it('are not judged, as the base answers them with fast errors', () => {
      const base = same(3, { routes: { worker: 6, upload: 1 }, checks: { worker: 1, upload: 0 } });
      const head = same(3, { routes: { worker: 6, upload: 12 } });

      const { regressions, markdown } = compareSummaries(base, head);

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| p95 upload (ms) | n/a | 12.0 | the base cannot serve it | ➖ |');
    });

    it('are left out of the throughput, as the fast errors of the base and the work of the pull request are not alike', () => {
      const base = same(3, { rate: 4000, routes: { worker: 6, upload: 1 }, checks: { worker: 1, upload: 0 }, routeRates: { upload: 1500 } });
      const head = same(3, { rate: 3300, routes: { worker: 6, upload: 12 }, routeRates: { upload: 800 } });

      const { regressions, markdown } = compareSummaries(base, head);

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| Throughput (req/s, without the routes the base cannot serve) | 2500 (2500-2500) | 2500 (2500-2500) | +0.0% | ✅ |');
    });

    it('still fail the throughput when the routes that both serve got slower', () => {
      const base = same(3, { rate: 4000, routes: { worker: 6, upload: 1 }, checks: { worker: 1, upload: 0 }, routeRates: { upload: 1500 } });
      const head = same(3, { rate: 2800, routes: { worker: 6, upload: 12 }, routeRates: { upload: 800 } });

      expect(compareSummaries(base, head).regressions).toEqual([expect.stringContaining('Throughput is 20.0% lower')]);
    });

    it('leave the throughput as it is when k6 reported no requests per route', () => {
      const base = same(3, { rate: 4000, routes: { worker: 6, upload: 1 }, checks: { worker: 1, upload: 0 } });
      const head = same(3, { rate: 3300, routes: { worker: 6, upload: 12 } });

      const { regressions, markdown } = compareSummaries(base, head);

      expect(regressions).toEqual([expect.stringContaining('Throughput is 17.5% lower')]);
      expect(markdown).toContain('| Throughput (req/s) | 4000 (4000-4000) | 3300 (3300-3300) | −17.5% | ❌ |');
    });

    it('are shown with n/a when the base has no figures for them at all', () => {
      const { regressions, markdown } = compareSummaries(same(3, { routes: { worker: 6 } }), same(3, { routes: { worker: 6, upload: 12 } }));

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| p95 upload (ms) | n/a | 12.0 | the base cannot serve it | ➖ |');
    });

    it('are judged again when the base serves them', () => {
      const base = same(3, { routes: { upload: 10 }, checks: { upload: 1 } });
      const head = same(3, { routes: { upload: 30 } });

      expect(compareSummaries(base, head).regressions).toHaveLength(1);
    });
  });

  describe('CPU bound run', () => {
    const compareCpu = (base: K6Summary[], head: K6Summary[]) => compareSummaries(same(), same(), {}, { baseCpu: base, headCpu: head });

    it('is not shown when there are no summaries of it', () => {
      expect(compareSummaries(same(), same()).markdown).not.toContain('CPU bound');
    });

    it('finds no regression with the same results', () => {
      const { regressions, markdown } = compareCpu(cpuRuns(3), cpuRuns(3));

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| p95 CPU bound (ms) | 12.0 | 12.0 | +0.0% | ✅ |');
      expect(markdown).toContain('| CPU bound dropped requests | 0 | 0 | n/a | ✅ |');
    });

    it('is a regression when the p95 is more than 30% and 5 ms higher', () => {
      const { regressions, markdown } = compareCpu(cpuRuns(3, { p95: 12 }), cpuRuns(3, { p95: 18 }));

      expect(regressions).toHaveLength(1);
      expect(regressions[0]).toContain('CPU bound run');
      expect(markdown).toContain('❌');
    });

    it('is not when it is 25% higher, or higher by less than 5 ms', () => {
      expect(compareCpu(cpuRuns(3, { p95: 20 }), cpuRuns(3, { p95: 25 })).regressions).toEqual([]);
      expect(compareCpu(cpuRuns(3, { p95: 3 }), cpuRuns(3, { p95: 7 })).regressions).toEqual([]);
    });

    it('is judged with the limit that is given', () => {
      const { regressions } = compareSummaries(
        same(),
        same(),
        { maxCpuP95Increase: 1 },
        { baseCpu: cpuRuns(3, { p95: 12 }), headCpu: cpuRuns(3, { p95: 18 }) }
      );

      expect(regressions).toEqual([]);
    });

    it('is a regression when it drops requests that the base took', () => {
      const { regressions } = compareCpu(cpuRuns(3), cpuRuns(3, { dropped: 40 }));

      expect(regressions).toEqual([expect.stringContaining('dropped 40 requests')]);
    });

    it('is not judged when the base cannot serve it', () => {
      const { regressions, markdown } = compareCpu(cpuRuns(3, { p95: 2, checks: 0 }), cpuRuns(3, { p95: 40, dropped: 10 }));

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| p95 CPU bound (ms) | n/a | 40.0 | the base cannot serve it | ➖ |');
    });

    it('uses the medians, so one bad run does not decide', () => {
      expect(compareCpu(cpuRuns(3), [cpuSummary(), cpuSummary(), cpuSummary({ p95: 300 })]).regressions).toEqual([]);
    });
  });

  describe('binary run', () => {
    const compareBinary = (base: K6Summary[], head: K6Summary[]) => compareSummaries(same(), same(), {}, { baseBinary: base, headBinary: head });

    it('is not shown when there are no summaries of it', () => {
      expect(compareSummaries(same(), same()).markdown).not.toContain('binary');
    });

    it('finds no regression with the same results', () => {
      const { regressions, markdown } = compareBinary(binaryRuns(3), binaryRuns(3));

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| p95 binary responses (ms) | 20.0 | 20.0 | +0.0% | ✅ |');
    });

    it('is a regression when the p95 is more than 50% and 5 ms higher', () => {
      const { regressions, markdown } = compareBinary(binaryRuns(3, { p95: 20 }), binaryRuns(3, { p95: 40 }));

      expect(regressions).toEqual([expect.stringContaining('big binary responses')]);
      expect(markdown).toContain('❌');
    });

    it('is not when it is 40% higher, or higher by less than 5 ms', () => {
      expect(compareBinary(binaryRuns(3, { p95: 20 }), binaryRuns(3, { p95: 28 })).regressions).toEqual([]);
      expect(compareBinary(binaryRuns(3, { p95: 3 }), binaryRuns(3, { p95: 7 })).regressions).toEqual([]);
    });

    it('shows a gain without judging it', () => {
      const { regressions, markdown } = compareBinary(binaryRuns(3, { p95: 27.5 }), binaryRuns(3, { p95: 11.1 }));

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| p95 binary responses (ms) | 27.5 | 11.1 | −59.6% | ✅ |');
    });

    it('is not judged when the base cannot serve it', () => {
      const { regressions, markdown } = compareBinary(binaryRuns(3, { p95: 2, checks: 0 }), binaryRuns(3, { p95: 40 }));

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| p95 binary responses (ms) | n/a | 40.0 | the base cannot serve it | ➖ |');
    });

    it('uses the medians, so one bad run does not decide', () => {
      expect(compareBinary(binaryRuns(3), [binarySummary(), binarySummary(), binarySummary({ p95: 300 })]).regressions).toEqual([]);
    });
  });

  describe('noise', () => {
    it('does not let one bad run decide, the medians of the runs are compared', () => {
      const base = runs({ rate: 4000 }, { rate: 4100 }, { rate: 3900 });
      const head = runs({ rate: 4000 }, { rate: 1000 }, { rate: 4050 });

      expect(compareSummaries(base, head).regressions).toEqual([]);
    });

    it('shows the range of the runs next to the median', () => {
      const { markdown } = compareSummaries(runs({ rate: 3900 }, { rate: 4100 }, { rate: 4000 }), runs({ rate: 4200 }, { rate: 4000 }, { rate: 4400 }));

      expect(markdown).toContain('| Throughput (req/s) | 4000 (3900-4100) | 4200 (4000-4400) | +5.0% | ✅ |');
    });

    it('says how many runs of each side it looked at', () => {
      expect(compareSummaries(same(3), same(2)).markdown).toContain('Medians of 3 runs of the base and 2 of the pull request');
    });
  });
});
