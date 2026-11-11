import type { JudgedRow } from '../types/comparison';
import { formatChange } from './format-change';
import { formatNumber } from './format-number';

export const buildJudgedRow = ({ label, base, head, comparable, failed, digits = 0 }: JudgedRow) => {
  const change = comparable ? formatChange(base, head) : 'the base cannot serve it';
  const verdict = failed ? '❌' : comparable ? '✅' : '➖';

  return `| ${label} | ${comparable ? formatNumber(base, digits) : 'n/a'} | ${formatNumber(head, digits)} | ${change} | ${verdict} |`;
};
