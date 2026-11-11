import type { ChannelBenchResult, ChannelMode } from '../types/channel-bench';
import { formatNumber } from './format-number';

/** the results of the modes as a markdown table, a row for every case and mode */
export const formatChannelBench = (results: Array<{ mode: ChannelMode; results: ChannelBenchResult[] }>): string =>
  [
    '| Case | Channel | Messages/s | Body MB/s | Parent CPU µs/message | Latency µs |',
    '| --- | --- | --- | --- | --- | --- |',
    ...results.flatMap(({ mode, results: modeResults }) =>
      modeResults.map(
        (result) =>
          `| ${result.name} | ${mode} | ${formatNumber(result.messagesPerSecond)} | ${formatNumber(result.bodyMegabytesPerSecond)} | ${formatNumber(
            result.parentCpuMicroseconds,
            1
          )} | ${formatNumber(result.latencyMicroseconds)} |`
      )
    ),
  ].join('\n');
