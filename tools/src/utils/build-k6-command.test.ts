import { buildK6Command } from './build-k6-command';

describe('buildK6Command', () => {
  const options = { scriptsDirectory: '/repo/tools/src/k6', script: 'example.ts', args: ['-e', 'DURATION=5s'], image: 'grafana/k6:1.2.2' };

  it('runs the installed k6 on the scenario', () => {
    expect(buildK6Command({ ...options, runner: 'native' })).toEqual(['k6', 'run', '-e', 'DURATION=5s', '/repo/tools/src/k6/example.ts']);
  });

  it('runs the image on the network of the host with the scenarios mounted', () => {
    expect(buildK6Command({ ...options, runner: 'docker' })).toEqual([
      'docker',
      'run',
      '--rm',
      '-i',
      '--network',
      'host',
      '--security-opt',
      'label=disable',
      '-v',
      '/repo/tools/src/k6:/scripts:ro',
      'grafana/k6:1.2.2',
      'run',
      '-e',
      'DURATION=5s',
      '/scripts/example.ts',
    ]);
  });
});
