import benchmarkVirtualHosts from '../utils/benchmark-virtual-hosts';
import logger from '../utils/logger';

/** `HOST_COUNTS` (comma separated) and `REQUESTS` (per count and routing) */
const hostCounts = (process.env.HOST_COUNTS ?? '1,10,100,1000,5000').split(',').map(Number);
const requests = Number(process.env.REQUESTS ?? 2000);

(async () => {
  try {
    for (const hostCount of hostCounts) {
      const { vhostPerHost, router } = await benchmarkVirtualHosts(hostCount, requests);
      logger.system(`${hostCount} hosts: ${vhostPerHost.toFixed(3)} ms with a vhost per host, ${router.toFixed(3)} ms with the router`);
    }
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
})();
