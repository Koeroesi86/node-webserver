import startServer from '@koeroesi86/node-webserver';

const start = (configPath: string): void => {
  (async () => {
    await new Promise((r) => setTimeout(r, 1));
    const configuration: Parameters<typeof startServer>[0] = require(configPath);
    await startServer(configuration);
  })();
};

export default start;
