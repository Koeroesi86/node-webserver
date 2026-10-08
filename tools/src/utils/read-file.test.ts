import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from './read-file';

describe('readFile', () => {
  const folder = mkdtempSync(join(tmpdir(), 'read-file-'));

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('is the content of the file', () => {
    writeFileSync(join(folder, 'file.txt'), 'content');

    expect(readFile(join(folder, 'file.txt'))).toBe('content');
  });

  it('is undefined when the file cannot be read', () => {
    expect(readFile(join(folder, 'missing.txt'))).toBeUndefined();
  });
});
