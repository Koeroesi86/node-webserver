import { defaultLimits } from '../constants/comparison-limits';
import type { BinarySummaries, ComparisonDetails, CpuSummaries, Limits } from '../types/comparison';
import type { K6Summary } from '../types/k6-summary';
import { buildInfoRows } from './build-info-rows';
import { describeJudgedMetrics } from './describe-judged-metrics';
import { getRoutes } from './get-routes';
import { judgeBinary } from './judge-binary';
import { judgeCpu } from './judge-cpu';
import { findExcludedRoutes, judgeRoutes } from './judge-routes';
import { judgeThroughput } from './judge-throughput';

/**
 * Compares the repetitions of both sides by their medians, the CPU bound run by the lowest p95 of each side.
 * A route is only judged when the base can serve it: the load test of a pull request may have routes that the base does not have.
 */
export const compareSummaries = (
  baseSummaries: K6Summary[],
  headSummaries: K6Summary[],
  limits: Partial<Limits> = {},
  { baseCpu = [], headCpu = [], baseBinary = [], headBinary = [] }: CpuSummaries & BinarySummaries = {}
): ComparisonDetails => {
  const allLimits = { ...defaultLimits, ...limits };
  const routes = getRoutes(headSummaries);
  const excluded = findExcludedRoutes(routes, baseSummaries, allLimits.minCheckRate);
  const hasCpu = baseCpu.length > 0 && headCpu.length > 0;
  const hasBinary = baseBinary.length > 0 && headBinary.length > 0;

  const judgements = [
    judgeThroughput(baseSummaries, headSummaries, excluded, allLimits.maxThroughputDrop),
    ...judgeRoutes(routes, baseSummaries, headSummaries, allLimits),
    ...(hasCpu ? [judgeCpu(baseCpu, headCpu, allLimits)] : []),
    ...(hasBinary ? [judgeBinary(baseBinary, headBinary, allLimits)] : []),
  ];
  const rows = judgements.flatMap((judgement) => judgement.rows);
  const regressions = judgements.flatMap((judgement) => judgement.regressions);

  const markdown = [
    `## Comparison with the base ${regressions.length === 0 ? '✅ no regression' : '❌ regression'}`,
    '',
    `Medians of ${baseSummaries.length} runs of the base and ${headSummaries.length} of the pull request, alternating, on the same machine. In brackets: the range of the runs.`,
    describeJudgedMetrics({
      limits: allLimits,
      cpuRuns: hasCpu ? { base: baseCpu.length, head: headCpu.length } : undefined,
      binaryRuns: hasBinary ? { base: baseBinary.length, head: headBinary.length } : undefined,
    }),
    '',
    '| Metric | Base | Pull request | Change | |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    ...buildInfoRows(baseSummaries, headSummaries),
    '',
    ...(regressions.length === 0 ? [] : ['### Regressions', '', ...regressions.map((regression) => `- ${regression}`), '']),
  ].join('\n');

  return { markdown, passed: regressions.length === 0, regressions };
};
