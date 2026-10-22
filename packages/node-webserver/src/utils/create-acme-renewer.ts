import { ACME_CHECK_INTERVAL } from '../constants';
import getAcmeFiles from './get-acme-files';
import getDate from './get-date';
import needsCertificate from './needs-certificate';
import requestCertificate from './request-certificate';
import writeCertificateFiles from './write-certificate-files';
import type { AcmeRenewer, AcmeRenewerContext, LoadedInstance } from '../types';

/**
 * Gets the certificates of the `acme` servers that have none or are about to expire, and loads the servers again when it got any. It works through the servers
 * one after the other, and a server that fails is left for the next look: the certificate it has stays in use.
 */
const createAcmeRenewer = ({ getLoaded, challenges, logger, reload, pollInterval, interval = ACME_CHECK_INTERVAL }: AcmeRenewerContext): AcmeRenewer => {
  let timer: NodeJS.Timeout | undefined;
  let checking = false;

  const issue = async ({ instance }: LoadedInstance) => {
    const { hostname, acme } = instance;
    if (!acme) return false;

    try {
      const { key, chain } = await requestCertificate({ hostname, acme, challenges, pollInterval });
      writeCertificateFiles(getAcmeFiles(instance), key, chain);
      logger.success(`[${getDate()}] Certificate for ${hostname} issued`);
      return true;
    } catch (error) {
      logger.error(`[${getDate()}] Certificate for ${hostname} was not issued, it is tried again later:`, error);
      return false;
    }
  };

  const isDue = ({ instance }: LoadedInstance) =>
    instance.protocol === 'https' &&
    instance.acme !== undefined &&
    !instance.hostname.includes('*') &&
    needsCertificate(getAcmeFiles(instance).cert, instance.acme.renewBeforeDays);

  const renew = async () => {
    const issued = await getLoaded()
      .filter(isDue)
      .reduce(async (count, server) => (await count) + Number(await issue(server)), Promise.resolve(0));

    if (issued > 0) reload();
  };

  const check = async () => {
    // a slow order must not be started a second time by the next look
    if (checking) return;
    checking = true;

    await renew()
      .catch((error) => logger.error(`[${getDate()}] The certificates could not be checked:`, error))
      .finally(() => {
        checking = false;
      });
  };

  return {
    start: () => {
      timer = setInterval(check, interval);
      // the look must not keep the process running, and the server ends it
      timer.unref();

      return check();
    },
    stop: () => clearInterval(timer),
    check,
  };
};

export default createAcmeRenewer;
