import findChildProblems from './find-child-problems';
import type { ChildOptions } from '../types';

const find = (args: ChildOptions['args'], port?: number) =>
  findChildProblems({ hostname: 'a.localhost', protocol: 'http', childOptions: { command: 'node', args }, proxyOptions: { port } }, 's').map(
    ({ setting, message }) => `${setting} ${message}`
  );

describe('findChildProblems', () => {
  it('finds nothing for a placeholder with or without a port, a port without a placeholder, and arguments of a function', () => {
    expect(find(['server.js', '--port=%PORT%'])).toEqual([]);
    expect(find(['server.js'], 3000)).toEqual([]);
    expect(find(['--port=%port%'], 3000)).toEqual([]);
    expect(find((ports) => [`${ports}`])).toEqual([]);
    expect(find(undefined)).toEqual([]);
  });

  it('finds a process that is not told its port', () => {
    expect(find(['server.js'])).toEqual(['childOptions.args needs %PORT% to tell the process its port, or proxyOptions.port to be set']);
  });
});
