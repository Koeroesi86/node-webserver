import { createAcmeRenewer } from '../acme';
import createCertificateRegistry from './create-certificate-registry';
import type { Logger } from '../types';

interface Options {
  logger: Logger;
  /** has the fronts load their servers again, with the certificates that were issued */
  reload: () => void;
  createRenewer?: typeof createAcmeRenewer;
}

/**
 * The certificates of the `acme` servers of a server with fronts: the primary alone orders them, for the servers its fronts name, has every front answer the challenges of the
 * authority, which may reach any of them, and has them load what it got.
 */
const createPrimaryCertificates = ({ logger, reload, createRenewer = createAcmeRenewer }: Options) => {
  let started = false;
  const registry = createCertificateRegistry(() => started && renewer.recheck());
  const renewer = createRenewer({
    getLoaded: () => registry.getServers().map((instance) => ({ instance })),
    challenges: registry.challenges,
    logger,
    reload,
  });

  return {
    service: registry,
    /** to call once the fronts serve, as the authority comes to the http port */
    start: () => {
      started = true;
      void renewer.start();
    },
    stop: () => {
      started = false;
      renewer.stop();
    },
  };
};

export default createPrimaryCertificates;
