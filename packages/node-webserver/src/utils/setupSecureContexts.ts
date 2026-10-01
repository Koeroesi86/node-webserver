import tls from 'tls';
import fs from 'fs';
import type { ServerInstance } from '../types';

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

function setupSecureContexts(instances: ServerInstance[] = []) {
  instances.forEach((instance) => {
    const { key, cert, ca } = instance;
    if (key && cert) {
      instance.secureContext = tls.createSecureContext({
        key: fs.readFileSync(key, 'utf8'),
        cert: fs.readFileSync(cert, 'utf8'),
        // If the 'ca' option is not given, then node.js will use the default
        ca: ca ? sslCADecode(fs.readFileSync(ca, 'utf8')) : undefined,
      });
    }
  });

  return instances;
}

export default setupSecureContexts;
