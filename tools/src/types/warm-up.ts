export interface Endpoint {
  /** the Host header, which tells the server which of its servers is meant */
  host: string;
  path: string;
  method?: string;
  body?: string;
}

export interface WarmUpResult {
  endpoint: Endpoint;
  /** whether the endpoint answered in time, a request that was not answered is not a failure of the run */
  ready: boolean;
  /** the status of the first answer, which tells whether the endpoint is served for real: a side that does not have a route may answer a 404 */
  status?: number;
}

export interface WarmUpOptions {
  /** requests sent to an endpoint once it answers, to get the workers and the code hot */
  requests: number;
  /** how many times an endpoint is polled until it answers, and how long to wait between two */
  attempts: number;
  intervalMs: number;
}
