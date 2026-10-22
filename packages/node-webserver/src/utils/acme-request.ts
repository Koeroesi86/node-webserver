import https from 'https';
import { ACME_REQUEST_TIMEOUT } from '../constants';
import type { AcmeRequestOptions, AcmeResponse } from '../types';

/** `fetch` of node cannot trust another authority for one request, which a private ACME server needs, so the request is made with `https` */
const acmeRequest = (url: string, { method = 'GET', headers, body, ca }: AcmeRequestOptions = {}): Promise<AcmeResponse> =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      { method, ca, headers: { ...headers, ...(body !== undefined && { 'Content-Length': Buffer.byteLength(body) }) } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
        response.on('error', reject);
      }
    );

    request.setTimeout(ACME_REQUEST_TIMEOUT, () => request.destroy(new Error(`${method} ${url} timed out`)));
    request.on('error', reject);
    request.end(body);
  });

export default acmeRequest;
