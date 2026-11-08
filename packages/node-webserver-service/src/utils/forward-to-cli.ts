import { spawn } from 'node:child_process';
import { once } from 'node:events';
import resolveCliScript from './resolve-cli-script';
import translateArguments from './translate-arguments';

/** what a service manager or a terminal sends to stop or reload the server */
const RELAYED_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

/** runs nws-cli with the translated arguments and ends the way it ended, so a service started by the old `--run` stops and reloads as before */
const forwardToCli = async (args: string[]): Promise<void> => {
  const cliArguments = translateArguments(args);

  console.warn(`@koeroesi86/node-webserver-service is deprecated, use: npx nws-cli ${cliArguments.join(' ')}`);

  const child = spawn(process.execPath, [resolveCliScript(), ...cliArguments], { stdio: 'inherit' });
  const relay = (signal: NodeJS.Signals) => child.kill(signal);

  RELAYED_SIGNALS.forEach((signal) => process.on(signal, relay));
  const [code, signal] = await once(child, 'exit');
  RELAYED_SIGNALS.forEach((relayed) => process.off(relayed, relay));

  // the server raises the signal again once it finished, which systemd counts as a clean stop of a unit it stopped
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
};

export default forwardToCli;
