import { existsSync, statSync } from 'fs';
import { rmSync } from 'fs';
import { basename, dirname } from 'path';
import { tmpdir } from 'os';
import createLambdaFolder from './create-lambda-folder';

describe('createLambdaFolder', () => {
  const made: string[] = [];

  afterEach(() => {
    made.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  it('makes a folder of its own that is named after the server, with a tmp folder in it', () => {
    const { root, tmp, storage } = createLambdaFolder(false);
    made.push(root);

    expect(dirname(root)).toBe(tmpdir());
    expect(basename(root)).toMatch(new RegExp(`^node-lambda-${process.pid}-`));
    expect(statSync(tmp).isDirectory()).toBe(true);
    expect(storage).toBeUndefined();
  });

  it('makes a folder for the storage when it is asked to, and a different one every time', () => {
    const first = createLambdaFolder(true);
    const second = createLambdaFolder(true);
    made.push(first.root, second.root);

    expect(first.storage && existsSync(first.storage)).toBe(true);
    expect(first.root).not.toBe(second.root);
  });
});
