import fs from 'fs';
import os from 'os';
import path from 'path';
import findLambdaProblems from './find-lambda-problems';
import type { LambdaOptions } from '../types';

describe('findLambdaProblems', () => {
  let folder: string;
  let lambda: string;

  beforeAll(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-problems-'));
    lambda = path.join(folder, 'lambda.js');
    fs.writeFileSync(lambda, '');
  });

  afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

  const find = (lambdaOptions?: LambdaOptions) =>
    findLambdaProblems({ hostname: 'a.localhost', protocol: 'http', type: 'lambda', lambdaOptions }, 's').map(
      ({ setting, message }) => `${setting} ${message.replace(folder, '<folder>')}`
    );

  it('finds nothing for a lambda, or routes to lambdas, that are there', () => {
    expect(find({ lambda })).toEqual([]);
    expect(
      find({
        routes: [
          { path: '/a', lambda },
          { pattern: '/b/(?<id>.+)', lambda },
        ],
      })
    ).toEqual([]);
  });

  it('finds nothing without options, as the schema requires them', () => {
    expect(find()).toEqual([]);
  });

  it('finds options that lead to no lambda', () => {
    expect(find({ limit: 1 })).toEqual(['lambdaOptions needs a lambda, or routes to lambdas']);
  });

  it('names the lambdas that are not files, and the patterns that are not valid', () => {
    expect(find({ lambda: path.join(folder, 'none.js'), routes: [{ pattern: '(', lambda: folder }] })).toEqual([
      'lambdaOptions.lambda is not a file: <folder>/none.js',
      'lambdaOptions.routes[0].lambda is not a file: <folder>',
      expect.stringContaining('lambdaOptions.routes[0].pattern Invalid regular expression'),
    ]);
  });
});
