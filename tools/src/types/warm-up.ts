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
}

export interface WarmUpOptions {
  /** requests sent to an endpoint once it answers, to get the workers and the code hot */
  requests: number;
  /** how many times an endpoint is polled until it answers, and how long to wait between two */
  attempts: number;
  intervalMs: number;
}
