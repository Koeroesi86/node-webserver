import createServerPlan from './create-server-plan';
import { sendMessage } from '../cluster';
import type { Configuration } from '../types';

/** the process that the primary starts to look at the configuration as it is now: it answers with the plan of its server, and ends. It serves nothing. */
const startPlan = async (configuration: Partial<Configuration>, configurationFile?: string): Promise<never> => {
  // the answer has to leave before the process ends, which the channel did not keep running until here
  process.channel?.ref();
  await sendMessage({ nodeWebserver: 'plan', plan: createServerPlan(configuration, configurationFile) });
  process.exit(0);
};

export default startPlan;
