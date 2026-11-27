import type { GithubRequest } from '../types/merge-queue';

/** the data of a GraphQL query or mutation. GitHub answers 200 for its errors, so they are looked for in the answer */
export const requestGraphql = async <T>(request: GithubRequest, query: string, variables: Record<string, string>): Promise<T> => {
  const { data, errors } = await request<{ data: T; errors?: unknown[] }>('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) });

  if (errors) {
    throw new Error(`GraphQL: ${JSON.stringify(errors)}`);
  }

  return data;
};
