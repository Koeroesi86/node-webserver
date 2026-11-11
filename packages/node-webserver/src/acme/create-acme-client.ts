import { createHash, createPublicKey, sign } from 'crypto';
import type { KeyObject } from 'crypto';
import acmeRequest from './acme-request';
import type { AcmeClient, AcmeDirectory, AcmeResponse } from '../types';

interface Problem {
  type?: string;
  detail?: string;
}

const MAX_BAD_NONCES = 2;

const readProblem = ({ body }: AcmeResponse): Problem => {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return {};
  }
};

const getJson = async <T>(url: string, ca?: string): Promise<T> => {
  const response = await acmeRequest(url, { ca });
  if (response.status !== 200) throw new Error(`GET ${url} answered ${response.status}: ${response.body.toString('utf8').slice(0, 200)}`);

  return JSON.parse(response.body.toString('utf8'));
};

/** the requests of RFC 8555 for an account key: the directory, the nonces and the signing of every request (ES256, a P-256 key) */
const createAcmeClient = async ({ directoryUrl, accountKey, ca }: { directoryUrl: string; accountKey: KeyObject; ca?: string }): Promise<AcmeClient> => {
  const directory = await getJson<AcmeDirectory>(directoryUrl, ca);
  const { kty, crv, x, y } = createPublicKey(accountKey).export({ format: 'jwk' });
  const thumbprint = createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url');
  let nonce: string | undefined;
  let kid: string | undefined;

  const takeNonce = async () => {
    const taken = nonce ?? (await acmeRequest(directory.newNonce, { method: 'HEAD', ca })).headers['replay-nonce'];
    nonce = undefined;
    if (typeof taken !== 'string') throw new Error(`${directory.newNonce} gave no Replay-Nonce`);

    return taken;
  };

  const body = (url: string, payload: object | undefined, replayNonce: string) => {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', nonce: replayNonce, url, ...(kid ? { kid } : { jwk: { crv, kty, x, y } }) })).toString(
      'base64url'
    );
    const content = payload === undefined ? '' : Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${content}`), { key: accountKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');

    return JSON.stringify({ protected: header, payload: content, signature });
  };

  const post: AcmeClient['post'] = async (url, payload, headers) => {
    const send = async (badNonces: number): Promise<AcmeResponse> => {
      const response = await acmeRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/jose+json', ...headers },
        body: body(url, payload, await takeNonce()),
        ca,
      });
      const replayNonce = response.headers['replay-nonce'];
      nonce = typeof replayNonce === 'string' ? replayNonce : undefined;

      // the server may have forgotten the nonce, which is no fault of the request: it is sent again with the new one
      if (readProblem(response).type === 'urn:ietf:params:acme:error:badNonce' && badNonces < MAX_BAD_NONCES) return send(badNonces + 1);
      if (response.status < 200 || response.status >= 300) {
        const { type, detail } = readProblem(response);
        throw new Error(`POST ${url} answered ${response.status}${type ? ` ${type}` : ''}${detail ? `: ${detail}` : ''}`);
      }

      return response;
    };

    return send(0);
  };

  const postJson: AcmeClient['postJson'] = async (url, payload) => {
    const response = await post(url, payload);

    return { data: JSON.parse(response.body.toString('utf8')), headers: response.headers };
  };

  const register = async (email: string) => {
    // agreeing to the terms of the authority is what setting `acme` stands for, see the README
    const { headers } = await postJson(directory.newAccount, { contact: [`mailto:${email}`], termsOfServiceAgreed: true });
    if (typeof headers.location !== 'string') throw new Error(`${directory.newAccount} gave no account URL`);
    kid = headers.location;
  };

  return { thumbprint, directory, register, post, postJson };
};

export default createAcmeClient;
