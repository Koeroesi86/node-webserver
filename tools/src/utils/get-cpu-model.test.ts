import { getCpuModel } from './get-cpu-model';

describe('getCpuModel', () => {
  it('reads the model of the processor from /proc/cpuinfo', () => {
    expect(getCpuModel('processor\t: 0\nvendor_id\t: AuthenticAMD\nmodel name\t: AMD EPYC 7763 64-Core Processor\ncpu MHz\t\t: 2445.4\n')).toBe(
      'AMD EPYC 7763 64-Core Processor'
    );
  });

  it('knows the field of ARM machines', () => {
    expect(getCpuModel('processor : 0\nModel : Raspberry Pi 4\n')).toBe('Raspberry Pi 4');
  });

  it('asks node when there is no /proc/cpuinfo', () => {
    expect(getCpuModel(undefined)).toEqual(expect.any(String));
  });
});
