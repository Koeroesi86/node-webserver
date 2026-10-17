import findDuplicateProblems from './find-duplicate-problems';

const entry = (hostname: string, protocol = 'http') => ({ instance: { hostname, protocol }, label: `${protocol}://${hostname}` });

describe('findDuplicateProblems', () => {
  it('finds nothing for hosts that differ, or the same host over the other protocol', () => {
    expect(findDuplicateProblems([entry('a.localhost'), entry('b.localhost'), entry('a.localhost', 'https')], { statsDomain: false })).toEqual([]);
  });

  it('names the server that serves the host first, whatever the case', () => {
    const [first, second] = [entry('a.localhost'), entry('A.localhost')];

    expect(findDuplicateProblems([first, second], { statsDomain: false })).toEqual([
      { severity: 'error', server: second.label, setting: 'hostname', message: `is already served by ${first.label}` },
    ]);
  });

  it('warns about a host that is the stats domain over http', () => {
    const stats = entry('stats.localhost');

    expect(findDuplicateProblems([stats, entry('stats.localhost', 'https')], { statsDomain: 'stats.localhost' })).toEqual([
      { severity: 'warning', server: stats.label, setting: 'hostname', message: expect.stringContaining('statsDomain') },
    ]);
  });
});
