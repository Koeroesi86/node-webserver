import { StaticOptionsEnv } from '../constants';
import createStaticWorkerOptions from './create-static-worker-options';

describe('createStaticWorkerOptions', () => {
  it('starts the worker in the current folder, without options of its own', () => {
    expect(createStaticWorkerOptions(undefined)).toEqual({ cwd: process.cwd() });
  });

  it('hands the normalized options to the worker as JSON in its environment', () => {
    const { env } = createStaticWorkerOptions({ listDirectories: true });
    const options = JSON.parse(env?.[StaticOptionsEnv] ?? '');

    expect(options).toEqual(expect.objectContaining({ listDirectories: true }));
    expect(env).toEqual(expect.objectContaining({ PATH: process.env.PATH }));
  });

  it('throws for options that are not valid', () => {
    expect(() => createStaticWorkerOptions({ cacheControl: [{ value: '' }] })).toThrow();
  });
});
