import { createServer } from 'node:http';
import type { OpenPullRequest } from '../types/merge-queue';

export interface GithubCall {
  method: string;
  path: string;
  authorization: string;
  body: string;
}

export interface GithubAnswer {
  status?: number;
  body: unknown;
}

/** a pull request as the query of the open ones gives it, without auto-merge and labels */
export const createPullRequest = (number: number, fields: Partial<OpenPullRequest> = {}): OpenPullRequest => ({
  number,
  id: `id-${number}`,
  headRefOid: `head-${number}`,
  headRefName: `branch-${number}`,
  isDraft: false,
  isCrossRepository: false,
  mergeable: 'MERGEABLE',
  labels: { nodes: [] },
  autoMergeRequest: null,
  ...fields,
});

export const listAnswer = (...nodes: OpenPullRequest[]): GithubAnswer => ({ body: { data: { repository: { pullRequests: { nodes } } } } });

/** a server on a free port that answers as the api of GitHub would, with what `answer` gives for a call. `calls` are the ones it got */
export const startFakeGithub = async (answer: (call: GithubCall) => GithubAnswer) => {
  const calls: GithubCall[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const call = {
        method: request.method ?? '',
        path: request.url ?? '',
        authorization: request.headers.authorization ?? '',
        body: Buffer.concat(chunks).toString(),
      };
      calls.push(call);
      const { status = 200, body } = answer(call);
      response.writeHead(status).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((done) => server.listen(0, () => done()));
  const address = server.address();

  return {
    url: `http://localhost:${typeof address === 'object' && address !== null ? address.port : 0}`,
    calls,
    stop: () => new Promise<void>((done) => server.close(() => done())),
  };
};
