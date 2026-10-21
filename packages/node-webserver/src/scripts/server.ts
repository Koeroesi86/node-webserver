import { startServer } from '../server';
import { createLogger, findPorts } from '../utils';
import Configuration from '../configuration.example';

const logger = createLogger(Configuration);
// the lines that wait are written when the process ends, also when the server did not start
process.on('exit', logger.flush);

const run = async () => {
  if (Configuration.portLookup) {
    await findPorts(Configuration.portLookup);
  }

  await startServer(Configuration, logger);
};

run().catch((error) => logger.error(error));
