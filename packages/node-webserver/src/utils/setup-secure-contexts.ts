import tls from 'tls';
import fs from 'fs';
import type { ServerState } from '../types';

// if CA contains more certificates it will be parsed to array
function sslCADecode(source?: string): string[] {
  if (!source || typeof source !== 'string') {
    return [];
  }

  return source.split(/-----END CERTIFICATE-----[\s\n]+-----BEGIN CERTIFICATE-----/).map((value, index, array) => {
    if (index > 0) {
      value = `-----BEGIN CERTIFICATE-----${value}`;
    }
    if (index !== array.length - 1) {
      value = `${value}-----END CERTIFICATE-----`;
    }
    value = value.replace(/^\n+/, '').replace(/\n+$/, '');
    return value;
  });
}

function setupSecureContexts(hosts: ServerState[] = []) {
  hosts.forEach(({ instance: { key, cert, ca, acme }, runtime }) => {
    // the files of an acme server are there once its certificate was issued, until then its handshakes fail
    if (key && cert && (!acme || (fs.existsSync(key) && fs.existsSync(cert)))) {
      runtime.secureContext = tls.createSecureContext({
        key: fs.readFileSync(key, 'utf8'),
        cert: fs.readFileSync(cert, 'utf8'),
        // If the 'ca' option is not given, then node.js will use the default
        ca: ca ? sslCADecode(fs.readFileSync(ca, 'utf8')) : undefined,
      });
    }
  });

  return hosts;
}

export default setupSecureContexts;
