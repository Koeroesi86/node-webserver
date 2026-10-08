import { setTimeout as sleep } from 'node:timers/promises';
import { defaultWarmUp, warmUpEndpoints, warmUpMaxStatus } from '../constants/warm-up';
import type { Endpoint, WarmUpOptions, WarmUpResult } from '../types/warm-up';
import { requestEndpoint } from './request-endpoint';

const isReady = (status: number | undefined) => status !== undefined && status < warmUpMaxStatus;

/** polls the endpoint until it answers, true when it did before the attempts ran out */
const waitForEndpoint = async (port: string, endpoint: Endpoint, attempts: number, intervalMs: number): Promise<boolean> => {
  if (attempts === 0) return false;
  if (isReady(await requestEndpoint(port, endpoint))) return true;
  await sleep(intervalMs);

  return waitForEndpoint(port, endpoint, attempts - 1, intervalMs);
};

/**
 * Starts the workers behind the endpoints and gets them hot before the measuring starts: every endpoint is polled until it answers,
 * then it gets a number of requests. The endpoints are warmed up at the same time, as their workers start at the same time in a run.
 * An endpoint that does not answer in time is reported, and the run goes on: the base may not have all the servers of the pull request.
 */
export const warmUpServer = (
  port: string,
  endpoints: Endpoint[] = warmUpEndpoints,
  { requests, attempts, intervalMs }: WarmUpOptions = defaultWarmUp
): Promise<WarmUpResult[]> =>
  Promise.all(
    endpoints.map(async (endpoint) => {
      const ready = await waitForEndpoint(port, endpoint, attempts, intervalMs);
      if (ready) await Promise.all(Array.from({ length: requests }, () => requestEndpoint(port, endpoint)));
      else console.error(`warm-up: ${endpoint.host}${endpoint.path} did not answer`);

      return { endpoint, ready };
    })
  );
