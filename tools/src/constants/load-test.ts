export const defaultPortHttp = '8080';
export const defaultPortHttps = '8443';
export const defaultRounds = 3;
export const defaultDuration = '15s';
export const defaultCpuDuration = '10s';

/** the server is polled this many times, this many milliseconds apart, until it answers */
export const serverReadyAttempts = 60;
export const serverReadyIntervalMs = 500;
/** a server that does not leave this soon after it was asked to is killed */
export const serverStopTimeoutMs = 5000;

/** the share of the time of a load test that was steal from which the numbers say little */
export const stealWarningPercent = 5;

/** the metric of the latency of a route, k6 tags the requests with `route` */
export const routeDurationPattern = /^http_req_duration\{route:(.+)\}$/;
