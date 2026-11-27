import { createRepository } from '../test-helpers/git-repository';
import { createRemoteGit } from './create-remote-git';

describe('createRemoteGit', () => {
  const repository = createRepository();
  repository.commit({ 'file.txt': '1' });

  afterAll(() => repository.remove());

  it('commits as the bot', async () => {
    await createRemoteGit(repository.path, 'secret')(
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '--allow-empty',
      '--author=A <a@example.com>',
      '-m',
      'empty'
    );

    expect(repository.git('log', '-1', '--format=%an, %cn')).toBe('A, github-actions[bot]');
  });

  it('gives git the token for github.com in the environment only', async () => {
    const header = `AUTHORIZATION: basic ${Buffer.from('x-access-token:secret').toString('base64')}`;
    const git = createRemoteGit(repository.path, 'secret');

    // `config --get name value` fails unless the value matches, so this passes only with the header of the token
    await git('config', '--fixed-value', '--get', 'http.https://github.com/.extraheader', header);
    expect(repository.git('config', '--local', '--list')).not.toContain('extraheader');
  });

  it('fails when git does', async () => {
    await expect(createRemoteGit(repository.path, 'secret')('switch', 'no-such-branch')).rejects.toThrow('no-such-branch');
  });
});
