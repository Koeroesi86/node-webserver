import startServer, { checkConfiguration, formatProblems } from '@koeroesi86/node-webserver';

/** starts the server of the configuration, or with `check` only says whether it would start, in the exit status */
const runServer = async (configPath: string, check: boolean): Promise<void> => {
  const configuration: Parameters<typeof startServer>[0] = require(configPath);

  if (!check) {
    await startServer(configuration);
    return;
  }

  const problems = checkConfiguration(configuration);
  const failed = problems.some(({ severity }) => severity === 'error');

  if (problems.length) console.error(formatProblems(problems));
  if (!failed) console.log(`${configPath} is valid.`);
  process.exitCode = failed ? 1 : 0;
};

export default runServer;
