import getFrontCount from './get-front-count';

describe('getFrontCount', () => {
  it('is what the configuration asks for', () => {
    expect(getFrontCount({ frontProcesses: 'auto' }, [], 8)).toBe(4);
  });

  it.each([[{ workerLimit: 2 }], [{ maxConnections: 2 }]])('runs no more fronts than %j', (limit) => {
    expect(getFrontCount({ frontProcesses: 4, ...limit }, [], 8)).toBe(2);
  });

  it('runs no more fronts than the smallest limit of a server', () => {
    const servers = [{ hostname: 'a.localhost', protocol: 'http', type: 'lambda' as const, lambdaOptions: { limit: 3 } }];

    expect(getFrontCount({ frontProcesses: 4, workerLimit: 8 }, servers, 8)).toBe(3);
  });

  it('takes a limit of 0 for no limit', () => {
    expect(getFrontCount({ frontProcesses: 4, workerLimit: 0, maxConnections: 0 }, [], 8)).toBe(4);
  });

  it('runs one front for a number below 1, which the check of the configuration reports', () => {
    expect(getFrontCount({ frontProcesses: 0 }, [], 8)).toBe(1);
  });
});
