import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import resolveCliScript from './resolve-cli-script';

describe('resolveCliScript', () => {
  it('finds the built script of nws-cli', () => {
    const script = resolveCliScript();

    expect(script.endsWith(`${sep}cli.js`)).toBe(true);
    expect(existsSync(script)).toBe(true);
  });
});
