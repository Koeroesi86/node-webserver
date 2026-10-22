import { findLayoutProblems } from './find-layout-problems';

const files: Record<string, string> = {
  'packages/a/src/utils/index.ts': "export { getDate } from './get-date';\n",
  'packages/a/src/utils/get-date.ts': 'export const getDate = () => new Date();\n',
  'packages/a/src/utils/get-date.test.ts': '',
};
const read = (path: string) => files[path];

describe('findLayoutProblems', () => {
  it('accepts a util that is exported, has one export and a test', () => {
    expect(findLayoutProblems(Object.keys(files), read)).toEqual([]);
  });

  it('finds a name that is not kebab-case', () => {
    expect(findLayoutProblems(['packages/a/src/types/getDate.ts'], read)).toEqual(['packages/a/src/types/getDate.ts: file names are kebab-case']);
  });

  it('finds a file that its index.ts does not export, also when there is no index.ts', () => {
    expect(findLayoutProblems(['packages/a/src/middlewares/proxy.ts', 'packages/a/src/utils/get-time.ts'], read)).toEqual(
      expect.arrayContaining([
        'packages/a/src/middlewares/proxy.ts: not exported by the index.ts next to it',
        'packages/a/src/utils/get-time.ts: not exported by the index.ts next to it',
      ])
    );
  });

  it('finds a util with more than one export or without a test', () => {
    const other: Record<string, string> = {
      'src/utils/index.ts': "export { a } from './a';",
      'src/utils/a.ts': 'export const a = 1;\nexport type A = number;\n',
    };

    expect(findLayoutProblems(['src/utils/a.ts'], (path) => other[path])).toEqual([
      'src/utils/a.ts: one exported function per file in utils/',
      'src/utils/a.ts: no a.test.ts next to it',
    ]);
  });

  it('leaves tests, helpers, index files and other folders alone', () => {
    expect(
      findLayoutProblems(['src/utils/b.test.ts', 'src/utils/mock.test-helper.ts', 'src/utils/index.ts', 'src/types/server.ts', 'README.md'], read)
    ).toEqual([]);
  });
});
