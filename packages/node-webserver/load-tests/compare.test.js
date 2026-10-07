const { spawnSync } = require('child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join, resolve } = require('path');
const { compare, median } = require('./compare');

/** a summary with the throughput, the p95 per route and whether the checks of the routes passed */
const summary = ({ rate = 4000, routes = { worker: 6, static: 7 }, checks = {}, connecting = 100, overall = 8 } = {}) => ({
  metrics: {
    http_reqs: { rate },
    http_req_duration: { 'p(95)': overall },
    ws_connecting: { 'p(95)': connecting },
    ...Object.fromEntries(Object.entries(routes).map(([route, p95]) => [`http_req_duration{route:${route}}`, { 'p(95)': p95 }])),
    ...Object.fromEntries(Object.entries(checks).map(([route, value]) => [`checks{route:${route}}`, { value }])),
  },
});

const runs = (...options) => options.map((option) => summary(option));
const same = (count = 3, options = {}) => Array.from({ length: count }, () => summary(options));

describe('compare', () => {
  describe('median', () => {
    it('is the middle value, or the mean of the two in the middle', () => {
      expect(median([3, 1, 2])).toBe(2);
      expect(median([4, 1, 3, 2])).toBe(2.5);
    });

    it('is not known for nothing, and leaves out what is not known', () => {
      expect(median([])).toBeUndefined();
      expect(median([undefined, 5, undefined])).toBe(5);
    });
  });

  describe('with the same results on both sides', () => {
    it('finds no regression', () => {
      const { regressions, markdown } = compare(same(), same());

      expect(regressions).toEqual([]);
      expect(markdown).toContain('✅ no regression');
      expect(markdown).toContain('| Throughput (req/s) | 4000 (4000-4000) | 4000 (4000-4000) | +0.0% | ✅ |');
    });

    it('lists a row for every route of the pull request, and the figures that are not judged', () => {
      const { markdown } = compare(same(), same());

      expect(markdown).toContain('| p95 worker (ms) | 6.0 | 6.0 | +0.0% | ✅ |');
      expect(markdown).toContain('| p95 static (ms) | 7.0 | 7.0 | +0.0% | ✅ |');
      expect(markdown).toContain('| p95 of all requests (ms) | 8.0 | 8.0 | +0.0% | ➖ |');
      expect(markdown).toContain('| WebSocket connect p95 (ms) | 100.0 | 100.0 | +0.0% | ➖ |');
    });
  });

  describe('throughput', () => {
    it('is a regression when it is more than 15% lower', () => {
      const { regressions, markdown } = compare(same(3, { rate: 4000 }), same(3, { rate: 3300 }));

      expect(regressions).toEqual([expect.stringContaining('Throughput is 17.5% lower')]);
      expect(markdown).toContain('❌ regression');
      expect(markdown).toContain('| Throughput (req/s) | 4000 (4000-4000) | 3300 (3300-3300) | −17.5% | ❌ |');
    });

    it('is not when it is 10% lower', () => {
      expect(compare(same(3, { rate: 4000 }), same(3, { rate: 3600 })).regressions).toEqual([]);
    });

    it('is not when it is higher', () => {
      expect(compare(same(3, { rate: 4000 }), same(3, { rate: 6000 })).regressions).toEqual([]);
    });

    it('is judged with the limit that is given', () => {
      expect(compare(same(3, { rate: 4000 }), same(3, { rate: 3600 }), { maxThroughputDrop: 0.05 }).regressions).toHaveLength(1);
    });
  });

  describe('latency of a route', () => {
    const withWorker = (p95) => same(3, { routes: { worker: p95, static: 7 } });

    it('is a regression when the p95 is more than 50% and 5 ms higher', () => {
      const { regressions, markdown } = compare(withWorker(10), withWorker(20));

      expect(regressions).toEqual([expect.stringContaining('The p95 of worker is 100.0% higher than the base (10.0 ms to 20.0 ms)')]);
      expect(markdown).toContain('| p95 worker (ms) | 10.0 | 20.0 | +100.0% | ❌ |');
    });

    it('is not when it is 40% higher', () => {
      expect(compare(withWorker(10), withWorker(14)).regressions).toEqual([]);
    });

    it('is not when it is many milliseconds higher but less than 50%, as a slow route varies more', () => {
      expect(compare(withWorker(100), withWorker(140)).regressions).toEqual([]);
    });

    it('is not when it is higher by a lot, but by less than 5 ms, as that is noise', () => {
      expect(compare(withWorker(2), withWorker(6)).regressions).toEqual([]);
    });

    it('is not when it is lower', () => {
      expect(compare(withWorker(10), withWorker(5)).regressions).toEqual([]);
    });

    it('names every route that got slower', () => {
      const { regressions } = compare(same(3, { routes: { worker: 10, static: 10 } }), same(3, { routes: { worker: 20, static: 30 } }));

      expect(regressions.map((regression) => regression.match(/p95 of (\w+)/)[1])).toEqual(['worker', 'static']);
    });
  });

  describe('routes that the base does not have', () => {
    it('are not judged, as the base answers them with fast errors', () => {
      const base = same(3, { routes: { worker: 6, upload: 1 }, checks: { worker: 1, upload: 0 } });
      const head = same(3, { routes: { worker: 6, upload: 12 } });

      const { regressions, markdown } = compare(base, head);

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| p95 upload (ms) | n/a | 12.0 | the base cannot serve it | ➖ |');
    });

    it('are shown with n/a when the base has no figures for them at all', () => {
      const { regressions, markdown } = compare(same(3, { routes: { worker: 6 } }), same(3, { routes: { worker: 6, upload: 12 } }));

      expect(regressions).toEqual([]);
      expect(markdown).toContain('| p95 upload (ms) | n/a | 12.0 | the base cannot serve it | ➖ |');
    });

    it('are judged again when the base serves them', () => {
      const base = same(3, { routes: { upload: 10 }, checks: { upload: 1 } });
      const head = same(3, { routes: { upload: 30 } });

      expect(compare(base, head).regressions).toHaveLength(1);
    });
  });

  describe('noise', () => {
    it('does not let one bad run decide, the medians of the runs are compared', () => {
      const base = runs({ rate: 4000 }, { rate: 4100 }, { rate: 3900 });
      const head = runs({ rate: 4000 }, { rate: 1000 }, { rate: 4050 });

      expect(compare(base, head).regressions).toEqual([]);
    });

    it('shows the range of the runs next to the median', () => {
      const { markdown } = compare(runs({ rate: 3900 }, { rate: 4100 }, { rate: 4000 }), runs({ rate: 4200 }, { rate: 4000 }, { rate: 4400 }));

      expect(markdown).toContain('| Throughput (req/s) | 4000 (3900-4100) | 4200 (4000-4400) | +5.0% | ✅ |');
    });

    it('says how many runs of each side it looked at', () => {
      expect(compare(same(3), same(2)).markdown).toContain('Medians of 3 runs of the base and 2 of the pull request');
    });
  });

  describe('command line', () => {
    let folder;

    beforeAll(() => {
      folder = mkdtempSync(join(tmpdir(), 'compare-'));
    });

    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    const write = (name, content) => {
      const path = join(folder, name);
      writeFileSync(path, JSON.stringify(content));

      return path;
    };
    const run = (args, env = {}) => spawnSync('node', [resolve(__dirname, 'compare.js'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

    it('prints the table and exits with 0 when there is no regression', () => {
      const result = run([
        '--base',
        write('b1.json', summary()),
        write('b2.json', summary()),
        '--head',
        write('h1.json', summary()),
        write('h2.json', summary()),
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('✅ no regression');
      expect(result.stdout).toContain('Medians of 2 runs of the base and 2 of the pull request');
    });

    it('exits with 1 on a regression, whatever side comes first', () => {
      const base = write('slow-b.json', summary({ rate: 4000 }));
      const head = write('slow-h.json', summary({ rate: 2000 }));

      expect(run(['--base', base, '--head', head]).status).toBe(1);
      expect(run(['--head', head, '--base', base]).status).toBe(1);
    });

    it('takes the limits from the environment', () => {
      const base = write('env-b.json', summary({ rate: 4000 }));
      const head = write('env-h.json', summary({ rate: 3000 }));

      expect(run(['--base', base, '--head', head]).status).toBe(1);
      expect(run(['--base', base, '--head', head], { MAX_THROUGHPUT_DROP: '0.5' }).status).toBe(0);
    });

    it('fails and says so when a side has no summary', () => {
      const result = run(['--base', join(folder, 'missing.json'), '--head', write('only-h.json', summary())]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('No summary of the base');
    });

    it('ignores the summaries that were not written, as long as one run of each side is there', () => {
      const result = run([
        '--base',
        join(folder, 'gone.json'),
        write('some-b.json', summary()),
        '--head',
        write('some-h.json', summary()),
        join(folder, 'gone-too.json'),
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Medians of 1 runs of the base and 1 of the pull request');
    });
  });
});
