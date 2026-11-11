import formatProblems from './format-problems';

describe('formatProblems', () => {
  it('writes a line for each problem, with the server when there is one', () => {
    expect(
      formatProblems([
        { severity: 'error', server: 'http://a.localhost', setting: 'options.root', message: 'is not a folder: /x' },
        { severity: 'warning', setting: 'portHttps', message: 'is odd' },
      ])
    ).toBe('error: http://a.localhost options.root is not a folder: /x\nwarning: portHttps is odd');
  });
});
