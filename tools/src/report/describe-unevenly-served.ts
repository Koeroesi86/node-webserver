import type { WarmUpResult } from '../types/warm-up';

const describeStatus = (status: number | undefined) => (status === undefined ? 'no answer' : String(status));

/**
 * What the sides answer differently at warm-up, as markdown, empty when they answer alike. A route that only one side serves for real
 * (the other answers a 404, or not at all) makes the load test of the pull request do work for one side only, which shows as a difference in speed that is not one.
 * It is told about and does not fail the comparison: a pull request that adds a route is allowed to. Its scenario belongs in a script of its own then (see tools/README.md).
 */
export const describeUnevenlyServed = (base: WarmUpResult[], head: WarmUpResult[]): string =>
  head
    .flatMap(({ endpoint, status }) => {
      const baseStatus = base.find((result) => result.endpoint.host === endpoint.host && result.endpoint.path === endpoint.path)?.status;

      return baseStatus === status
        ? []
        : [`- \`${endpoint.host}${endpoint.path}\`: ${describeStatus(baseStatus)} on the base, ${describeStatus(status)} on the pull request`];
    })
    .join('\n');
