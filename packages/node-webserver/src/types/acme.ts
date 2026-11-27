import type http from 'http';
import type { Logger } from './logger';
import type { ServerConfig } from './server';

export interface AcmeOptions {
  /** the contact address the certificate authority writes to about the account and the certificates that are about to expire */
  email: string;
  /** the folder for the account key and, unless the server sets `key` and `cert`, for the certificates (`<storagePath>/<hostname>/privkey.pem` and `fullchain.pem`). Made when it is missing. */
  storagePath: string;
  /** the directory URL of the ACME server, https only. Defaults to the production directory of Let's Encrypt. */
  directory?: string;
  /** the file with the certificates of the authority the directory is checked against, for a private ACME server such as Pebble */
  directoryCa?: string;
  /** how many days before a certificate expires it is renewed. Defaults to when a third of its lifetime is left. */
  renewBeforeDays?: number;
}

/** the tokens of the `http-01` challenges that wait for the certificate authority, with the answer to each */
export type AcmeChallenges = Map<string, string>;

/** where the answers of the challenges go before the authority is asked to check them */
export interface ChallengeStore {
  /** may resolve once the answer is there to be asked for */
  set: (token: string, answer: string) => unknown;
  delete: (token: string) => unknown;
}

/** what of an `acme` server it takes to order its certificate */
export type CertificateServer = Pick<ServerConfig, 'hostname' | 'protocol' | 'key' | 'cert' | 'acme'>;

export interface AcmeRequestOptions {
  method?: string;
  headers?: http.OutgoingHttpHeaders;
  body?: string;
  /** the certificates the server is checked against, instead of the ones node trusts */
  ca?: string;
}

export interface AcmeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface AcmeDirectory {
  newNonce: string;
  newAccount: string;
  newOrder: string;
}

export interface AcmeClient {
  /** of the account key, which the answer of a challenge is made of */
  thumbprint: string;
  directory: AcmeDirectory;
  /** finds or makes the account, which every later request is signed for */
  register: (email: string) => Promise<void>;
  /** a signed request. Without a payload it is a POST-as-GET, the way ACME reads a resource. */
  post: (url: string, payload?: object, headers?: http.OutgoingHttpHeaders) => Promise<AcmeResponse>;
  postJson: <T>(url: string, payload?: object) => Promise<{ data: T; headers: http.IncomingHttpHeaders }>;
}

export interface CertificateOrder {
  hostname: string;
  acme: AcmeOptions;
  challenges: ChallengeStore;
  /** how long to wait between two looks at an order or a challenge that is not done, in milliseconds. Defaults to 2000. */
  pollInterval?: number;
  /** how many looks before the order is given up. Defaults to 60. */
  maxPolls?: number;
}

export interface AcmeRenewer {
  /** looks at once and then every hour, and returns when the first look is done */
  start: () => Promise<void>;
  stop: () => void;
  check: () => Promise<void>;
  /** looks now, or once the look that runs is done, for a server that was added */
  recheck: () => void;
}

export interface AcmeRenewerContext {
  getLoaded: () => Array<{ instance: CertificateServer }>;
  challenges: ChallengeStore;
  logger: Logger;
  /** loads the servers again, so that new connections get the new certificates */
  reload: () => void;
  pollInterval?: number;
  interval?: number;
}
