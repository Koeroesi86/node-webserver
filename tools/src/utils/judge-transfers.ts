import type { Judgement, Limits, TransferSummaries } from '../types/comparison';
import { judgeTransfer } from './judge-transfer';

/** the big uploads and the big downloads, each judged when both sides have runs of it, and how many runs of each side there were */
export const judgeTransfers = (
  { baseUploads = [], headUploads = [], baseDownloads = [], headDownloads = [] }: TransferSummaries,
  limits: Limits
): { judgements: Judgement[]; runs: { base: number; head: number } | undefined } => {
  const judgements = [
    {
      subject: 'The speed of the big uploads',
      label: 'big uploads, median speed (MB/s)',
      metric: 'big_upload_mb_per_s',
      checks: 'checks{route:big-upload}',
      baseRuns: baseUploads,
      headRuns: headUploads,
      limits,
    },
    {
      subject: 'The speed of the big downloads',
      label: 'big downloads, median speed (MB/s)',
      metric: 'download_mb_per_s',
      checks: 'checks{route:download}',
      baseRuns: baseDownloads,
      headRuns: headDownloads,
      limits,
    },
  ]
    .filter(({ baseRuns, headRuns }) => baseRuns.length > 0 && headRuns.length > 0)
    .map(judgeTransfer);
  const runs = { base: baseUploads.length || baseDownloads.length, head: headUploads.length || headDownloads.length };

  return { judgements, runs: judgements.length > 0 ? runs : undefined };
};
