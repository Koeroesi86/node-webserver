import os from 'os';
import inspectConfiguration from './inspect-configuration';

describe('inspectConfiguration', () => {
  const child = { hostname: 'child.localhost', protocol: 'http', type: 'child' as const, childOptions: { command: 'node', args: ['%PORT%'] } };
  const servers = [{ ...child, proxyOptions: {}, serverOptions: { protocol: 'http' } }];

  beforeEach(() => jest.spyOn(os, 'availableParallelism').mockReturnValue(8));
  afterEach(() => jest.restoreAllMocks());

  it('counts the fronts the configuration and its servers would run', () => {
    expect(inspectConfiguration({ frontProcesses: 'auto', maxConnections: 3, servers: [] }).frontCount).toBe(3);
  });

  it.each([[2 as const], ['auto' as const]])('has nothing against a child server with frontProcesses %s', (frontProcesses) => {
    expect(inspectConfiguration({ frontProcesses, servers })).toEqual({ problems: [], frontCount: expect.any(Number) });
  });
});
