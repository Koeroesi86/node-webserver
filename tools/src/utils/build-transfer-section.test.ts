import { buildTransferSection } from './build-transfer-section';

describe('buildTransferSection', () => {
  const speed = (med: number, avg: number, min: number) => ({ med, avg, min });

  it('is empty when the run had no uploads', () => {
    expect(buildTransferSection({})).toEqual([]);
  });

  it('is empty when only one of the modes ran', () => {
    expect(buildTransferSection({ 'big_upload_mb_per_s{mode:keep-alive}': speed(500, 490, 400) })).toEqual([]);
  });

  it('compares the two modes, the change being what keeping the connection gained', () => {
    const section = buildTransferSection({
      'http_reqs{mode:keep-alive}': { count: 120 },
      'http_reqs{mode:reconnect}': { count: 110 },
      'big_upload_mb_per_s{mode:keep-alive}': speed(550, 540, 410),
      'big_upload_mb_per_s{mode:reconnect}': speed(500, 490, 400),
      'big_upload_new_connection{mode:keep-alive}': { value: 0.008 },
      'big_upload_new_connection{mode:reconnect}': { value: 1 },
    });

    expect(section).toContain('| Uploads | 120 | 110 | |');
    expect(section).toContain('| Speed median (MB/s) | 550 | 500 | +10.0% |');
    expect(section).toContain('| Speed average (MB/s) | 540 | 490 | +10.2% |');
    expect(section).toContain('| Slowest (MB/s) | 410 | 400 | +2.5% |');
    expect(section).toContain('| On a new connection | 1% | 100% | |');
  });

  it('shows a loss as a loss', () => {
    const section = buildTransferSection({
      'big_upload_mb_per_s{mode:keep-alive}': speed(450, 450, 450),
      'big_upload_mb_per_s{mode:reconnect}': speed(500, 500, 500),
    });

    expect(section).toContain('| Speed median (MB/s) | 450 | 500 | −10.0% |');
    expect(section).toContain('| Uploads | 0 | 0 | |');
    expect(section).toContain('| On a new connection | n/a | n/a | |');
  });

  it('has a section for the downloads as well', () => {
    const section = buildTransferSection({
      'http_reqs{mode:keep-alive}': { count: 40 },
      'http_reqs{mode:reconnect}': { count: 30 },
      'download_mb_per_s{mode:keep-alive}': speed(2000, 1900, 1500),
      'download_mb_per_s{mode:reconnect}': speed(1000, 900, 800),
    });

    expect(section).toContain('### Connection after a big download');
    expect(section).toContain('| Downloads | 40 | 30 | |');
    expect(section).toContain('| Speed median (MB/s) | 2000 | 1000 | +100.0% |');
    expect(section).not.toContain('big upload');
  });
});
