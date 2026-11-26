import os from 'os';
import inspectConfiguration from './inspect-configuration';

describe('inspectConfiguration', () => {
  const child = { hostname: 'child.localhost', protocol: 'http', type: 'child' as const, childOptions: { command: 'node', args: ['%PORT%'] } };
  const servers = [{ ...child, proxyOptions: {}, serverOptions: { protocol: 'http' } }];
  const frontErrors = (configuration: Parameters<typeof inspectConfiguration>[0]) =>
    inspectConfiguration(configuration).problems.filter(({ message }) => message.includes('one front'));

  beforeEach(() => jest.spyOn(os, 'availableParallelism').mockReturnValue(8));
  afterEach(() => jest.restoreAllMocks());

  it('counts the fronts the configuration and its servers would run', () => {
    expect(inspectConfiguration({ frontProcesses: 'auto', maxConnections: 3, servers: [] }).frontCount).toBe(3);
  });

  it.each([[2 as const], ['auto' as const]])('refuses a child server with frontProcesses %s', (frontProcesses) => {
    expect(frontErrors({ frontProcesses, servers })).toHaveLength(1);
  });

  it('takes a child server with one front, also when a limit brings the fronts down to one', () => {
    expect([...frontErrors({ servers }), ...frontErrors({ frontProcesses: 4, workerLimit: 1, servers })]).toEqual([]);
  });
});
