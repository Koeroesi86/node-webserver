const { findPorts } = require('../utils/ports');
const logger = require('../utils/logger');
const startServer = require('../utils/startServer');
const Configuration = require(process.env.NODE_WEBSERVER_CONFIG || '../configuration');

// process.chdir(__dirname);

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
