import startServer from '@koeroesi86/node-webserver';

/** a rejection is the caller's to handle, so that a failed start ends the process with an error */
const start = async (configPath: string): Promise<void> => {
  const configuration: Parameters<typeof startServer>[0] = require(configPath);
  await startServer(configuration);
};

export default start;
