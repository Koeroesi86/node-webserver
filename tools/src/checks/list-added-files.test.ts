import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepository } from '../test-helpers/git-repository';
import { listAddedFiles } from './list-added-files';

describe('listAddedFiles', () => {
  const repository = createRepository();

  afterAll(() => repository.remove());

  it('lists the files added since the base, committed or not, and not the changed ones', () => {
    repository.commit({ 'old.ts': 'a', 'changed.ts': 'a' });
    const base = repository.commit({ 'also-old.ts': 'a' });
    repository.commit({ 'changed.ts': 'b', 'src/new.ts': 'a' });
    writeFileSync(join(repository.path, 'draft.ts'), 'a');

    expect(listAddedFiles(repository.path, base)).toEqual(['src/new.ts', 'draft.ts']);
  });
});
