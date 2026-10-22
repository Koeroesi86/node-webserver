import { X509Certificate, generateKeyPairSync } from 'crypto';
import fs from 'fs';
import { ACME_DEFAULT_DIRECTORY } from '../constants';
import createAcmeClient from './create-acme-client';
import createCertificateRequest from './create-certificate-request';
import loadAcmeAccountKey from './load-acme-account-key';
import type { AcmeClient, CertificateOrder } from '../types';

interface Resource {
  status: string;
  error?: { detail?: string };
}

interface Order extends Resource {
  authorizations: string[];
  finalize: string;
  certificate?: string;
}

interface Authorization extends Resource {
  challenges: Array<{ type: string; url: string; token: string; status: string; error?: { detail?: string } }>;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** reads the resource until it is no longer in one of the waiting states, or fails with what the server said when it ended badly */
const settle = async <T extends Resource>(client: AcmeClient, url: string, waiting: string[], { pollInterval = 2000, maxPolls = 60 }: CertificateOrder) => {
  const look = async (polls: number): Promise<T> => {
    const { data } = await client.postJson<T>(url);
    if (!waiting.includes(data.status)) return data;
    if (polls >= maxPolls) throw new Error(`${url} is still ${data.status} after ${polls} looks`);
    await wait(pollInterval);

    return look(polls + 1);
  };

  return look(1);
};

const answerChallenge = async (client: AcmeClient, url: string, challengeUrl: string, order: CertificateOrder) => {
  // an empty object, not nothing: it tells the server that the answer is ready
  await client.postJson(challengeUrl, {});
  const settled = await settle<Authorization>(client, url, ['pending', 'processing'], order);
  if (settled.status === 'valid') return;

  const failed = settled.challenges.find(({ error }) => error);
  throw new Error(`${url} is ${settled.status}${failed?.error?.detail ? `: ${failed.error.detail}` : ''}`);
};

const solveAuthorization = async (client: AcmeClient, url: string, order: CertificateOrder) => {
  const { data: authorization } = await client.postJson<Authorization>(url);
  if (authorization.status === 'valid') return;

  const challenge = authorization.challenges.find(({ type }) => type === 'http-01');
  if (!challenge) throw new Error(`${url} offers no http-01 challenge`);

  order.challenges.set(challenge.token, `${challenge.token}.${client.thumbprint}`);
  try {
    await answerChallenge(client, url, challenge.url, order);
  } finally {
    order.challenges.delete(challenge.token);
  }
};

/** the order of RFC 8555 for one host name with the `http-01` challenge: the key and the chain (PEM) of a new certificate, with a new key for each */
const requestCertificate = async (order: CertificateOrder): Promise<{ key: string; chain: string }> => {
  const { hostname, acme } = order;
  const { directory = ACME_DEFAULT_DIRECTORY, storagePath, email, directoryCa } = acme;
  const client = await createAcmeClient({
    directoryUrl: directory,
    accountKey: loadAcmeAccountKey(storagePath, directory),
    ca: directoryCa ? fs.readFileSync(directoryCa, 'utf8') : undefined,
  });
  await client.register(email);

  const { data: placed, headers } = await client.postJson<Order>(client.directory.newOrder, { identifiers: [{ type: 'dns', value: hostname }] });
  const orderUrl = headers.location;
  if (typeof orderUrl !== 'string') throw new Error(`${client.directory.newOrder} gave no order URL`);

  await Promise.all(placed.authorizations.map((url) => solveAuthorization(client, url, order)));

  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const csr = createCertificateRequest(hostname, privateKey, publicKey).toString('base64url');
  await client.postJson(placed.finalize, { csr });

  const finished = await settle<Order>(client, orderUrl, ['pending', 'ready', 'processing'], order);
  if (finished.status !== 'valid' || !finished.certificate)
    throw new Error(`${orderUrl} is ${finished.status}${finished.error?.detail ? `: ${finished.error.detail}` : ''}`);

  const chain = (await client.post(finished.certificate, undefined, { Accept: 'application/pem-certificate-chain' })).body.toString('utf8');
  const certificate = new X509Certificate(chain);
  // a certificate that is not for this host or key would be served to the clients as it is
  if (!certificate.checkPrivateKey(privateKey) || !certificate.checkHost(hostname))
    throw new Error(`the certificate from ${directory} is not for ${hostname} and the new key`);

  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), chain };
};

export default requestCertificate;
