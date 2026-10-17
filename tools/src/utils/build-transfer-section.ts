import type { Metric, Metrics } from '../types/k6-summary';
import { formatChange } from './format-change';
import { formatNumber } from './format-number';

const percent = (value: number | undefined) => (value === undefined ? 'n/a' : `${(value * 100).toFixed(0)}%`);

/** the metric of a mode of a transfer scenario: `keep-alive` leaves the connection to the server, `reconnect` asks for it to be closed after every transfer */
const ofMode = (metrics: Metrics, name: string, mode: string): Metric | undefined => metrics[`${name}{mode:${mode}}`];

interface Transfer {
  title: string;
  /** what one transfer is called, in the plural */
  noun: string;
  /** the prefix of the metrics of the scenario */
  prefix: string;
}

const transfers: Transfer[] = [
  { title: 'Connection after a big upload', noun: 'uploads', prefix: 'big_upload' },
  { title: 'Connection after a big download', noun: 'downloads', prefix: 'download' },
];

const buildSection = (metrics: Metrics, { title, noun, prefix }: Transfer) => {
  const [kept, closed] = ['keep-alive', 'reconnect'].map((mode) => ({
    count: ofMode(metrics, 'http_reqs', mode),
    speed: ofMode(metrics, `${prefix}_mb_per_s`, mode),
    newConnection: ofMode(metrics, `${prefix}_new_connection`, mode),
  }));
  if (kept.speed === undefined || closed.speed === undefined) return [];

  return [
    `### ${title}`,
    '',
    `The same ${noun} one after the other on the same server: the first leaves the connection to the server, which the worker gives back after it is done so that the client uses it for its next request, the second asks for it to be closed after every one (what every handed over transfer did before the worker gave connections back).`,
    '',
    '| | Connection kept | Closed after every one | Change |',
    '| --- | --- | --- | --- |',
    `| ${noun[0].toUpperCase()}${noun.slice(1)} | ${kept.count?.count ?? 0} | ${closed.count?.count ?? 0} | |`,
    `| Speed median (MB/s) | ${formatNumber(kept.speed.med)} | ${formatNumber(closed.speed.med)} | ${formatChange(closed.speed.med, kept.speed.med)} |`,
    `| Speed average (MB/s) | ${formatNumber(kept.speed.avg)} | ${formatNumber(closed.speed.avg)} | ${formatChange(closed.speed.avg, kept.speed.avg)} |`,
    `| Slowest (MB/s) | ${formatNumber(kept.speed.min)} | ${formatNumber(closed.speed.min)} | ${formatChange(closed.speed.min, kept.speed.min)} |`,
    `| On a new connection | ${percent(kept.newConnection?.value)} | ${percent(closed.newConnection?.value)} | |`,
    '',
  ];
};

/** empty when the run had no transfers in both modes */
export const buildTransferSection = (metrics: Metrics) => transfers.flatMap((transfer) => buildSection(metrics, transfer));
