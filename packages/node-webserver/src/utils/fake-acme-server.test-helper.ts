import { createHash, createPublicKey, randomBytes, verify } from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { spawnSync } from 'child_process';
import makeCertificate from './make-certificate.test-helper';
import type { JsonWebKey } from 'crypto';

interface Order {
  hostname: string;
  token: string;
  state: 'pending' | 'ready' | 'processing' | 'valid';
  authorization: 'pending' | 'valid' | 'invalid';
  chain?: string;
}

export interface FakeAcmeServer {
  /** the directory URL, which is https with a certificate that `ca` holds */
  directory: string;
  ca: string;
  /** the certificate that signs what the server issues, for a client that checks the chain */
  root: string;
  /** every request the server got, as `METHOD /path` */
  requests: string[];
  /** the orders it took, by host name */
  hostnames: string[];
  /** what the server does with the challenges: `rejectChallenges` fails the validation, as it does when the authority cannot reach the host, `stallChallenges` never finishes it */
  behaviour: { rejectChallenges: boolean; stallChallenges: boolean };
  /** forgets the nonces it handed out, so that the next request of a client fails with badNonce */
  forgetNonces: () => void;
  stop: () => Promise<void>;
}

const problem = (type: string, detail: string) => JSON.stringify({ type: `urn:ietf:params:acme:error:${type}`, detail });

const thumbprint = ({ crv, kty, x, y }: JsonWebKey) => createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url');

const fail = (response: http.ServerResponse) => (error: unknown) => {
  response.writeHead(500);
  response.end(error instanceof Error ? 'fake acme server failed' : 'unexpected failure');
};

const readBody = (request: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

/** the answer of the `http-01` challenge from the host, fetched like the authority does, from `challengePort` on this machine */
const fetchChallenge = (challengePort: number, hostname: string, token: string) =>
  new Promise<string>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: challengePort, path: `/.well-known/acme-challenge/${token}`, headers: { Host: hostname } }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          response.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`answered ${response.statusCode}`))
        );
      })
      .on('error', reject);
  });

/**
 * An ACME server that does what the authority does and checks what a client has to get right: the signature of every request (ES256, the nonce, the URL),
 * the account, the `http-01` challenge fetched from the host, a certificate request that openssl accepts, and a certificate for it signed by a CA of its own.
 */
const startFakeAcmeServer = async (folder: string, challengePort: () => number, { days = 90 }: { days?: number } = {}): Promise<FakeAcmeServer> => {
  const authority = makeCertificate(folder, 'authority.localhost');
  const tls = makeCertificate(folder, 'localhost');
  const nonces = new Set<string>();
  const accounts = new Map<string, JsonWebKey>();
  const orders = new Map<string, Order>();
  const state = { rejectChallenges: false, stallChallenges: false };
  const requests: string[] = [];
  const hostnames: string[] = [];
  let base = '';

  const sign = (hostname: string, request: Buffer) => {
    const csr = path.join(folder, `${hostname}.csr.pem`);
    const extension = path.join(folder, `${hostname}.ext`);
    const cert = path.join(folder, `${hostname}.issued.pem`);
    fs.writeFileSync(
      csr,
      `-----BEGIN CERTIFICATE REQUEST-----\n${request.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE REQUEST-----\n`
    );
    fs.writeFileSync(extension, `subjectAltName=DNS:${hostname}\n`);
    const made = spawnSync(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        csr,
        '-CA',
        authority.cert,
        '-CAkey',
        authority.key,
        '-set_serial',
        `0x${randomBytes(8).toString('hex')}`,
        '-days',
        String(days),
        '-extfile',
        extension,
        '-out',
        cert,
      ],
      { encoding: 'utf8' }
    );
    if (made.status !== 0) throw new Error(made.stderr);

    return `${fs.readFileSync(cert, 'utf8')}${fs.readFileSync(authority.cert, 'utf8')}`;
  };

  const validate = async (id: string, order: Order, accountKey: JsonWebKey) => {
    if (state.stallChallenges) return;
    const expected = `${order.token}.${thumbprint(accountKey)}`;
    const answer = state.rejectChallenges ? undefined : await fetchChallenge(challengePort(), order.hostname, order.token).catch(() => undefined);
    order.authorization = answer === expected ? 'valid' : 'invalid';
    if (order.authorization === 'valid') order.state = 'ready';
    orders.set(id, order);
  };

  type Answer = { status: number; headers?: http.OutgoingHttpHeaders; body: string };
  type Handler = (payload: Record<string, unknown>, key: JsonWebKey, order: Order, id: string, path: string) => Answer;

  const json = (body: object, status = 200, headers: http.OutgoingHttpHeaders = {}): Answer => ({ status, headers, body: JSON.stringify(body) });

  const failure = { type: 'urn:ietf:params:acme:error:unauthorized', detail: 'could not fetch the token' };

  const handlers: Record<string, Handler> = {
    authz: (payload, key, order, id) =>
      json({
        status: order.authorization,
        challenges: [
          { type: 'dns-01', url: `${base}/dns/${id}`, token: 'unused', status: 'pending' },
          {
            type: 'http-01',
            url: `${base}/chall/${id}`,
            token: order.token,
            status: order.authorization,
            ...(order.authorization === 'invalid' && { error: failure }),
          },
        ],
      }),
    chall: (payload, key, order, id, path) => {
      void validate(id, order, key);
      return json({ status: 'pending', type: 'http-01', url: `${base}${path}`, token: order.token });
    },
    finalize: (payload, key, order, id, path) => {
      order.chain = sign(order.hostname, Buffer.from(String(payload.csr), 'base64url'));
      order.state = 'processing';
      return json({ status: 'processing', authorizations: [], finalize: `${base}${path}` });
    },
    // the first look after the finalizing still finds the certificate being made
    order: (payload, key, order, id) => {
      const seen = order.state;
      order.state = seen === 'processing' ? 'valid' : seen;
      return json({
        status: seen,
        authorizations: [`${base}/authz/${id}`],
        finalize: `${base}/finalize/${id}`,
        ...(seen === 'valid' && { certificate: `${base}/cert/${id}` }),
      });
    },
    cert: (payload, key, order) =>
      order.chain ? { status: 200, headers: { 'Content-Type': 'application/pem-certificate-chain' }, body: order.chain } : { status: 404, body: '' },
  };

  const newAccount = (payload: Record<string, unknown>, key: JsonWebKey): Answer => {
    const known = accounts.has(thumbprint(key));
    accounts.set(thumbprint(key), key);
    const acceptable = payload.termsOfServiceAgreed === true && Array.isArray(payload.contact);

    return acceptable
      ? json({ status: 'valid' }, known ? 200 : 201, { Location: `${base}/acct/${thumbprint(key)}` })
      : { status: 400, body: problem('malformed', 'terms') };
  };

  const newOrder = (payload: Record<string, unknown>): Answer => {
    const identifiers = payload.identifiers as Array<{ type: string; value: string }>;
    const created = randomBytes(6).toString('hex');
    orders.set(created, { hostname: identifiers[0].value, token: randomBytes(16).toString('base64url'), state: 'pending', authorization: 'pending' });
    hostnames.push(identifiers[0].value);

    return json({ status: 'pending', authorizations: [`${base}/authz/${created}`], finalize: `${base}/finalize/${created}` }, 201, {
      Location: `${base}/order/${created}`,
    });
  };

  const route = (path: string, payload: Record<string, unknown>, key: JsonWebKey): Answer => {
    const [, kind, id] = path.split('/');
    const order = orders.get(id);

    if (kind === 'new-acct') return newAccount(payload, key);
    if (kind === 'new-order') return newOrder(payload);

    return order && Object.hasOwn(handlers, kind)
      ? handlers[kind](payload, key, order, id, path)
      : { status: 404, body: problem('malformed', 'no such resource') };
  };

  /** the account of a request, when its nonce, URL, algorithm and signature are right, otherwise the answer to send */
  const authenticate = (
    request: http.IncomingMessage,
    header: Record<string, string | JsonWebKey>,
    signed: string,
    signature: string
  ): { key: JsonWebKey } | { answer: Answer } => {
    const key = (header.jwk as JsonWebKey | undefined) ?? accounts.get(String(header.kid).split('/').pop() ?? '');

    if (!nonces.delete(String(header.nonce))) return { answer: { status: 400, body: problem('badNonce', 'unknown nonce') } };
    if (header.url !== `${base}${request.url}` || header.alg !== 'ES256' || !key)
      return { answer: { status: 401, body: problem('unauthorized', 'wrong url, algorithm or account') } };

    const valid = verify(
      'sha256',
      Buffer.from(signed),
      { key: createPublicKey({ key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url')
    );

    return valid ? { key } : { answer: { status: 403, body: problem('malformed', 'bad signature') } };
  };

  const post = async (request: http.IncomingMessage, response: http.ServerResponse) => {
    const { protected: protectedPart, payload: payloadPart, signature } = JSON.parse(await readBody(request));
    const header = JSON.parse(Buffer.from(protectedPart, 'base64url').toString('utf8'));
    const send = ({ status, body, headers }: Answer) => {
      const nonce = randomBytes(12).toString('base64url');
      nonces.add(nonce);
      response.writeHead(status, { 'Replay-Nonce': nonce, 'Content-Type': 'application/json', ...headers });
      response.end(body);
    };
    const authenticated = authenticate(request, header, `${protectedPart}.${payloadPart}`, signature);

    if ('answer' in authenticated) return send(authenticated.answer);

    try {
      return send(route(String(request.url), payloadPart ? JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) : {}, authenticated.key));
    } catch (error) {
      return send({ status: 400, body: problem('badCSR', String(error)) });
    }
  };

  const server = https.createServer({ key: fs.readFileSync(tls.key), cert: fs.readFileSync(tls.cert) }, (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    // RFC 8555 6.1, which Pebble enforces
    if (!request.headers['user-agent']) {
      response.writeHead(400, { 'Content-Type': 'application/problem+json' });
      response.end(problem('malformed', 'All requests MUST include a User-Agent header'));
      return;
    }
    if (request.method === 'POST') {
      post(request, response).catch(fail(response));
      return;
    }
    const nonce = randomBytes(12).toString('base64url');
    nonces.add(nonce);
    response.writeHead(request.url === '/directory' ? 200 : 204, { 'Replay-Nonce': nonce, 'Content-Type': 'application/json' });
    response.end(
      request.url === '/directory' ? JSON.stringify({ newNonce: `${base}/nonce`, newAccount: `${base}/new-acct`, newOrder: `${base}/new-order` }) : undefined
    );
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `https://localhost:${(server.address() as { port: number }).port}`;

  return {
    directory: `${base}/directory`,
    ca: tls.cert,
    root: authority.cert,
    requests,
    hostnames,
    behaviour: state,
    forgetNonces: () => nonces.clear(),
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

export default startFakeAcmeServer;
