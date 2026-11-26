import { checkConfiguration, formatProblems, startCluster, startLauncher } from '@koeroesi86/node-webserver';

/**
 * Starts the server of the configuration, with the front processes it asks for, behind a launcher that this process becomes first: it runs this command again as the server,
 * which loads the configuration. With `check` only says whether it would start, in the exit status.
 */
const runServer = async (configPath: string, check: boolean): Promise<void> => {
  // before the configuration is loaded, which the launcher has no use for
  if (!check && startLauncher()) return;

  const configuration: Parameters<typeof startCluster>[0] = require(configPath);

  if (!check) {
    await startCluster(configuration, undefined, { configurationFile: configPath });
    return;
  }

  const problems = checkConfiguration(configuration);
  const failed = problems.some(({ severity }) => severity === 'error');

  if (problems.length) console.error(formatProblems(problems));
  if (!failed) console.log(`${configPath} is valid.`);
  process.exitCode = failed ? 1 : 0;
};

export default runServer;
