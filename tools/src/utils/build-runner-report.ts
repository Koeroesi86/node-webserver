import { stealWarningPercent } from '../constants/load-test';
import type { Snapshot } from '../types/runner';
import { getStealPercent } from './get-steal-percent';

export const buildRunnerReport = (before: Snapshot, after: Snapshot | undefined) => {
  const steal = getStealPercent(before, after);

  return [
    '### Runner',
    '',
    '| | |',
    '| --- | --- |',
    `| Processor | ${before.cpuModel} |`,
    `| Cores | ${before.cores} |`,
    `| Steal time during the test | ${steal === undefined ? 'n/a' : `${steal.toFixed(1)}%`} |`,
    '',
    ...(steal !== undefined && steal > stealWarningPercent
      ? ['⚠️ The machine was held back by its host for a noticeable part of the test, the numbers of this run say little.', '']
      : []),
  ].join('\n');
};
