import findFrontProcessesProblems from './find-front-processes-problems';

describe('findFrontProcessesProblems', () => {
  it.each([[undefined], ['auto' as const], [1], [3]])('takes %s on 3 cores', (frontProcesses) => {
    expect(findFrontProcessesProblems(frontProcesses, 3)).toEqual([]);
  });

  it.each([
    [4, 3, 3],
    [5, 64, 4],
  ])('reports %i fronts on %i cores', (frontProcesses, cores, max) => {
    expect(findFrontProcessesProblems(frontProcesses, cores)).toEqual([
      { severity: 'error', setting: 'frontProcesses', message: expect.stringContaining(`at most ${max}`) },
    ]);
  });
});
