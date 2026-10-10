import type { JudgedMetrics } from '../types/comparison';

export const describeJudgedMetrics = ({ limits, cpuRuns, binaryRuns }: JudgedMetrics) => {
  const { maxThroughputDrop, maxP95Increase, maxCpuP95Increase, minP95DifferenceMs } = limits;
  const cpu = cpuRuns
    ? ` The CPU bound run (${cpuRuns.base} runs of the base, ${
        cpuRuns.head
      } of the pull request, at a fixed rate) is judged on the lowest p95 of its runs (at most ${
        maxCpuP95Increase * 100
      }% and ${minP95DifferenceMs} ms higher) and on dropped requests.`
    : '';
  const binary = binaryRuns
    ? ` The big binary responses (${binaryRuns.base} runs of the base, ${binaryRuns.head} of the pull request, 768 KiB each) are judged on their p95 like a route.`
    : '';

  return `Judged: throughput (at most ${maxThroughputDrop * 100}% lower) and the p95 of every route (at most ${
    maxP95Increase * 100
  }% and ${minP95DifferenceMs} ms higher).${cpu}${binary}`;
};
