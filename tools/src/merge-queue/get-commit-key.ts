import type { PullRequestCommit } from '../types/merge-queue';

/** what a rebase keeps of a commit, which gets a new sha: the date of the author and the message */
export const getCommitKey = ({ commit }: PullRequestCommit): string => `${commit.author.date} ${commit.message}`;
