import './load-test-env';
import { findPorts } from '../utils/ports';
import logger from '../utils/logger';
import startServer from '../utils/startServer';
import Configuration from '../configuration.load-test';

(async () => {
  try {
    if (Configuration.portLookup) {
      await findPorts(Configuration.portLookup);
    }

    await startServer(Configuration);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
})();
