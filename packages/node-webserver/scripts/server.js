const { findPorts } = require('../utils/ports');
const logger = require('../utils/logger');
const startServer = require('../utils/startServer');
const Configuration = require('../configuration.example');

(async () => {
  try {
    if (Configuration.portLookup) {
      await findPorts(Configuration.portLookup);
    }

    await startServer(Configuration);
  } catch (error) {
    logger.error(error);
  }
})();
