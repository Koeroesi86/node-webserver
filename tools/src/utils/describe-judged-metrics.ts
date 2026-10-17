import type { JudgedMetrics } from '../types/comparison';

export const describeJudgedMetrics = ({ limits, cpuRuns, binaryRuns, transferRuns }: JudgedMetrics) => {
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

  const transfers = transferRuns
    ? ` The big uploads and downloads (${transferRuns.base} runs of the base, ${transferRuns.head} of the pull request, 16 and 32 MiB each, the worker reads or writes them itself) are judged on their median speed: the base closes the connection after each of them, the pull request keeps it, and it may not be more than ${
        maxThroughputDrop * 100
      }% slower.`
    : '';

  return `Judged: throughput (at most ${maxThroughputDrop * 100}% lower) and the p95 of every route (at most ${
    maxP95Increase * 100
  }% and ${minP95DifferenceMs} ms higher).${cpu}${binary}${transfers}`;
};
