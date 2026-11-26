import { checkConfiguration, formatProblems, startCluster } from '@koeroesi86/node-webserver';

/** starts the server of the configuration, with the front processes it asks for, or with `check` only says whether it would start, in the exit status */
const runServer = async (configPath: string, check: boolean): Promise<void> => {
  const configuration: Parameters<typeof startCluster>[0] = require(configPath);

  if (!check) {
    await startCluster(configuration);
    return;
  }

  const problems = checkConfiguration(configuration);
  const failed = problems.some(({ severity }) => severity === 'error');

  if (problems.length) console.error(formatProblems(problems));
  if (!failed) console.log(`${configPath} is valid.`);
  process.exitCode = failed ? 1 : 0;
};

export default runServer;
