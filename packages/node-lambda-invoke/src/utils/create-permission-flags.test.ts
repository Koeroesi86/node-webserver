import createPermissionFlags from './create-permission-flags';

describe('createPermissionFlags', () => {
  it('lets the lambda read everything and write only in the folders it is given', () => {
    const flags = createPermissionFlags(['/tmp/a/tmp', '/tmp/a/storage']);

    expect(flags).toEqual(expect.arrayContaining(['--allow-fs-read=*', '--allow-fs-write=/tmp/a/tmp', '--allow-fs-write=/tmp/a/storage']));
    expect(flags.filter((flag) => flag.startsWith('--allow-fs-write'))).toHaveLength(2);
    expect(flags[0]).toMatch(/^--(experimental-)?permission$/);
  });

  it('only uses flags that the running node knows', () => {
    createPermissionFlags(['/tmp/a']).forEach((flag) => expect(process.allowedNodeEnvironmentFlags.has(flag.split('=')[0])).toBe(true));
  });
});
