import benchmarkVirtualHosts from '../utils/benchmark-virtual-hosts';
import createLogger from '../utils/create-logger';
import Configuration from '../configuration.example';

const logger = createLogger(Configuration);
process.on('exit', logger.flush);

/** `HOST_COUNTS` (comma separated) and `REQUESTS` (per count and routing) */
const hostCounts = (process.env.HOST_COUNTS ?? '1,10,100,1000,5000').split(',').map(Number);
const requests = Number(process.env.REQUESTS ?? 2000);

const run = async () => {
  for (const hostCount of hostCounts) {
    const { vhostPerHost, router } = await benchmarkVirtualHosts(hostCount, requests);
    logger.system(`${hostCount} hosts: ${vhostPerHost.toFixed(3)} ms with a vhost per host, ${router.toFixed(3)} ms with the router`);
  }
};

run().catch((error) => {
  logger.error(error);
  process.exit(1);
});
