import { existsSync, readFileSync } from 'node:fs';
import type { K6Summary, Metrics } from './k6-summary';

// Compares the k6 summaries of the base of a pull request with the ones of the pull request itself, both measured in the same job.
//   node compare.js --base base-1.json base-2.json ... --head head-1.json head-2.json ... [--base-cpu ...] [--head-cpu ...]
// Prints markdown for the job summary and exits with 1 when the pull request is clearly slower.
// MAX_THROUGHPUT_DROP (0.15) and MAX_P95_INCREASE (0.5) are shares, MIN_P95_DIFFERENCE_MS (5) is how many milliseconds slower a route has to be as well, as a few milliseconds are noise.
// The load is a fixed number of users, so a build that is faster gets more requests through every route, which makes the routes compete for the cores: the p95 of a route can rise while the build is better.
// The throughput is the figure that holds, the limits for a route are wide on purpose and only catch a route that got much slower.
// The CPU bound run (cpu.js) has a fixed arrival rate, so its latency does not depend on how fast the rest is: its p95 is judged with a tighter limit (MAX_CPU_P95_INCREASE, 0.3), and requests that the server dropped are a regression.
// Its summaries come after --base-cpu and --head-cpu, and are optional.

export interface Limits {
  maxThroughputDrop: number;
  maxP95Increase: number;
  maxCpuP95Increase: number;
  minP95DifferenceMs: number;
  minCheckRate: number;
}

export interface CpuSummaries {
  baseCpu?: K6Summary[];
  headCpu?: K6Summary[];
}

const defaults: Limits = {
  maxThroughputDrop: 0.15,
  maxP95Increase: 0.5,
  maxCpuP95Increase: 0.3,
  minP95DifferenceMs: 5,
  minCheckRate: 0.9,
};

export const median = (values: (number | undefined)[]): number | undefined => {
  const sorted = values.filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const spread = (values: (number | undefined)[]) => {
  const known = values.filter((value): value is number => value !== undefined);

  return known.length === 0 ? undefined : { min: Math.min(...known), max: Math.max(...known) };
};

/** a metric of every repetition of one side */
const collect = (summaries: K6Summary[], read: (metrics: Metrics) => number | undefined) => summaries.map(({ metrics }) => read(metrics));

const routesOf = (summaries: K6Summary[]) => [
  ...new Set(
    summaries
      .flatMap(({ metrics }) => Object.keys(metrics).map((metric) => metric.match(/^http_req_duration\{route:(.+)\}$/)?.[1]))
      .filter((route): route is string => route !== undefined)
  ),
];

const number = (value: number | undefined, digits = 0) => (value === undefined ? 'n/a' : value.toFixed(digits));
const change = (base: number | undefined, head: number | undefined) =>
  base === undefined || head === undefined || base === 0 ? 'n/a' : `${head >= base ? '+' : '−'}${Math.abs(((head - base) / base) * 100).toFixed(1)}%`;

/**
 * Compares the repetitions of both sides by their medians.
 * A route is only judged when the base can serve it: the load test of a pull request may have routes that the base does not have.
 */
export const compare = (
  baseSummaries: K6Summary[],
  headSummaries: K6Summary[],
  limits: Partial<Limits> = {},
  { baseCpu = [], headCpu = [] }: CpuSummaries = {}
) => {
  const { maxThroughputDrop, maxP95Increase, maxCpuP95Increase, minP95DifferenceMs, minCheckRate } = { ...defaults, ...limits };
  const hasCpu = baseCpu.length > 0 && headCpu.length > 0;
  const regressions: string[] = [];
  const rows: string[] = [];

  const baseRate = median(collect(baseSummaries, (metrics) => metrics.http_reqs?.rate));
  const headRate = median(collect(headSummaries, (metrics) => metrics.http_reqs?.rate));
  const rateSpread = (summaries: K6Summary[]) => {
    const range = spread(collect(summaries, (metrics) => metrics.http_reqs?.rate));
    return range === undefined ? 'n/a' : `${number(range.min)}-${number(range.max)}`;
  };
  const droppedTooFar = baseRate !== undefined && headRate !== undefined && headRate < baseRate * (1 - maxThroughputDrop);
  if (droppedTooFar)
    regressions.push(`Throughput is ${change(baseRate, headRate).replace('−', '')} lower than the base, the limit is ${maxThroughputDrop * 100}%.`);
  rows.push(
    `| Throughput (req/s) | ${number(baseRate)} (${rateSpread(baseSummaries)}) | ${number(headRate)} (${rateSpread(headSummaries)}) | ${change(
      baseRate,
      headRate
    )} | ${droppedTooFar ? '❌' : '✅'} |`
  );

  routesOf(headSummaries).forEach((route) => {
    const p95 = (summaries: K6Summary[]) => median(collect(summaries, (metrics) => metrics[`http_req_duration{route:${route}}`]?.['p(95)']));
    const checkRate = median(collect(baseSummaries, (metrics) => metrics[`checks{route:${route}}`]?.value));
    const [base, head] = [p95(baseSummaries), p95(headSummaries)];
    // a base that cannot serve the route answers with errors, which are fast
    const comparable = base !== undefined && (checkRate === undefined || checkRate >= minCheckRate);
    const slower = comparable && head !== undefined && head > base * (1 + maxP95Increase) && head - base > minP95DifferenceMs;
    if (slower)
      regressions.push(
        `The p95 of ${route} is ${change(base, head).replace('+', '')} higher than the base (${number(base, 1)} ms to ${number(head, 1)} ms), the limit is ${
          maxP95Increase * 100
        }%.`
      );
    rows.push(
      `| p95 ${route} (ms) | ${comparable ? number(base, 1) : 'n/a'} | ${number(head, 1)} | ${comparable ? change(base, head) : 'the base cannot serve it'} | ${
        slower ? '❌' : comparable ? '✅' : '➖'
      } |`
    );
  });

  if (hasCpu) {
    const cpuP95 = (summaries: K6Summary[]) => median(collect(summaries, (metrics) => metrics['http_req_duration{route:cpu}']?.['p(95)']));
    const cpuDropped = (summaries: K6Summary[]) => median(collect(summaries, (metrics) => metrics.dropped_iterations?.count ?? 0));
    const cpuCheckRate = median(collect(baseCpu, (metrics) => metrics['checks{route:cpu}']?.value));
    const [base, head] = [cpuP95(baseCpu), cpuP95(headCpu)];
    // a base without the CPU bound worker answers with fast errors
    const comparable = base !== undefined && (cpuCheckRate === undefined || cpuCheckRate >= minCheckRate);
    const slower = comparable && head !== undefined && head > base * (1 + maxCpuP95Increase) && head - base > minP95DifferenceMs;
    if (slower)
      regressions.push(
        `The p95 of the CPU bound run is ${change(base, head).replace('+', '')} higher than the base (${number(base, 1)} ms to ${number(
          head,
          1
        )} ms), the limit is ${maxCpuP95Increase * 100}%.`
      );
    rows.push(
      `| p95 CPU bound (ms) | ${comparable ? number(base, 1) : 'n/a'} | ${number(head, 1)} | ${
        comparable ? change(base, head) : 'the base cannot serve it'
      } | ${slower ? '❌' : comparable ? '✅' : '➖'} |`
    );

    const [baseDropped, headDropped] = [cpuDropped(baseCpu), cpuDropped(headCpu)];
    const dropsMore = comparable && (headDropped ?? 0) > (baseDropped ?? 0);
    if (dropsMore)
      regressions.push(`The CPU bound run dropped ${number(headDropped)} requests the server could not take on time, the base ${number(baseDropped)}.`);
    rows.push(
      `| CPU bound dropped requests | ${comparable ? number(baseDropped) : 'n/a'} | ${number(headDropped)} | ${
        comparable ? change(baseDropped, headDropped) : 'the base cannot serve it'
      } | ${dropsMore ? '❌' : comparable ? '✅' : '➖'} |`
    );
  }

  const info = (
    [
      ['p95 of all requests (ms)', (metrics) => metrics.http_req_duration?.['p(95)']],
      ['WebSocket connect p95 (ms)', (metrics) => metrics.ws_connecting?.['p(95)']],
    ] satisfies [string, (metrics: Metrics) => number | undefined][]
  ).map(([name, read]) => {
    const [base, head] = [median(collect(baseSummaries, read)), median(collect(headSummaries, read))];
    return `| ${name} | ${number(base, 1)} | ${number(head, 1)} | ${change(base, head)} | ➖ |`;
  });

  const markdown = [
    `## Comparison with the base ${regressions.length === 0 ? '✅ no regression' : '❌ regression'}`,
    '',
    `Medians of ${baseSummaries.length} runs of the base and ${headSummaries.length} of the pull request, alternating, on the same machine. In brackets: the range of the runs.`,
    `Judged: throughput (at most ${maxThroughputDrop * 100}% lower) and the p95 of every route (at most ${
      maxP95Increase * 100
    }% and ${minP95DifferenceMs} ms higher).${
      hasCpu
        ? ` The CPU bound run (${baseCpu.length} runs of the base, ${headCpu.length} of the pull request, at a fixed rate) is judged on its p95 (at most ${
            maxCpuP95Increase * 100
          }% and ${minP95DifferenceMs} ms higher) and on dropped requests.`
        : ''
    }`,
    '',
    '| Metric | Base | Pull request | Change | |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    ...info,
    '',
    ...(regressions.length === 0 ? [] : ['### Regressions', '', ...regressions.map((regression) => `- ${regression}`), '']),
  ].join('\n');

  return { markdown, regressions };
};

if (require.main === module) {
  // the files after --base are the runs of the base, the ones after --head the runs of the pull request
  const groups = new Map<string, string[]>(['--base', '--head', '--base-cpu', '--head-cpu'].map((name) => [name, []]));
  process.argv.slice(2).reduce<string[] | undefined>((current, argument) => {
    const next = groups.get(argument);
    if (next === undefined) current?.push(argument);

    return next ?? current;
  }, undefined);
  const load = (name: string): K6Summary[] => (groups.get(name) ?? []).filter((path) => existsSync(path)).map((path) => JSON.parse(readFileSync(path, 'utf8')));
  const [base, head] = [load('--base'), load('--head')];
  const cpu = { baseCpu: load('--base-cpu'), headCpu: load('--head-cpu') };

  if (base.length === 0 || head.length === 0) {
    console.log(
      `## Comparison with the base\n\n❌ ${
        base.length === 0 ? 'No summary of the base' : 'No summary of the pull request'
      } was produced, the runs failed. Check the step logs.`
    );
    process.exit(1);
  }

  const limits: Partial<Limits> = Object.fromEntries(
    Object.entries({
      maxThroughputDrop: process.env.MAX_THROUGHPUT_DROP,
      maxP95Increase: process.env.MAX_P95_INCREASE,
      maxCpuP95Increase: process.env.MAX_CPU_P95_INCREASE,
      minP95DifferenceMs: process.env.MIN_P95_DIFFERENCE_MS,
    })
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([name, value]) => [name, Number(value)])
  );
  const { markdown, regressions } = compare(base, head, limits, cpu);
  console.log(markdown);
  process.exit(regressions.length === 0 ? 0 : 1);
}
