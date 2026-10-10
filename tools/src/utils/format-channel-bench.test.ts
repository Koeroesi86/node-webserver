import { formatChannelBench } from './format-channel-bench';

describe('formatChannelBench', () => {
  it('prints a row for every case of every channel', () => {
    const result = { name: '4 KiB body', messagesPerSecond: 56534.4, bodyMegabytesPerSecond: 231.5, parentCpuMicroseconds: 15.94, latencyMicroseconds: 1132.2 };

    expect(
      formatChannelBench([
        { mode: 'socket', results: [result] },
        { mode: 'ipc', results: [{ ...result, messagesPerSecond: 19542 }] },
      ]).split('\n')
    ).toEqual([
      '| Case | Channel | Messages/s | Body MB/s | Parent CPU µs/message | Latency µs |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 4 KiB body | socket | 56534 | 232 | 15.9 | 1132 |',
      '| 4 KiB body | ipc | 19542 | 232 | 15.9 | 1132 |',
    ]);
  });
});
