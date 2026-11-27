import { startFakeGithub } from '../test-helpers/fake-github';
import { createGithubRequest } from './create-github-request';
import { findOldBase } from './find-old-base';

const commitOf = (sha: string, name = sha) => ({ sha, commit: { author: { date: name }, message: `message of ${name}` } });
const merged = { number: 5, merged_at: '2026-11-02T07:00:00Z' };
const open = { number: 9, merged_at: null };

describe('findOldBase', () => {
  let github: Awaited<ReturnType<typeof startFakeGithub>>;
  // the pull requests that GitHub knows for a commit, by its sha, and the commits of the merged pull request
  let associated: Record<string, unknown[]> = {};
  let mergedCommits: unknown[] = [];
  const target = () => ({ request: createGithubRequest('secret', github.url), repository: 'owner/name', base: 'master' });

  beforeAll(async () => {
    github = await startFakeGithub(({ path }) => {
      if (path.includes('/pulls?state=closed')) return { body: mergedCommits.length > 0 ? [merged] : [] };
      if (path.includes('/pulls/5/commits')) return { body: mergedCommits };
      if (path.includes('/pulls/9/commits')) return { body: [commitOf('p1'), commitOf('p2'), commitOf('c1')] };

      return { body: associated[path.split('/')[5]] ?? [open] };
    });
  });

  beforeEach(() => {
    associated = {};
    mergedCommits = [];
  });

  afterAll(() => github.stop());

  it('is the last commit of the merged pull request below', async () => {
    associated = { p1: [merged], p2: [merged] };

    await expect(findOldBase(target(), 9)).resolves.toBe('p2');
  });

  it('matches the commits that were rebased before their merge by the date of the author and the message', async () => {
    mergedCommits = [commitOf('rebased-p1', 'p1'), commitOf('rebased-p2', 'p2')];

    await expect(findOldBase(target(), 9)).resolves.toBe('p2');
  });

  it('is undefined when no commit belongs to a merged pull request', async () => {
    await expect(findOldBase(target(), 9)).resolves.toBeUndefined();
  });

  it('is undefined when every commit belongs to one', async () => {
    associated = { p1: [merged], p2: [merged], c1: [merged] };

    await expect(findOldBase(target(), 9)).resolves.toBeUndefined();
  });
});
