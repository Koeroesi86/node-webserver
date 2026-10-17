import type { ConfigurationProblem, Logger } from '../types';
import formatProblems from './format-problems';
import getDate from './getDate';

/** logs the warnings and throws with all the problems when there is an error among them, so that what is wrong is read at once and not one error per start */
const reportProblems = (problems: ConfigurationProblem[], logger: Logger) => {
  problems.filter(({ severity }) => severity === 'warning').forEach((problem) => logger.warning(`[${getDate()}] ${formatProblems([problem])}`));

  if (problems.some(({ severity }) => severity === 'error')) {
    throw new Error(`The configuration has problems:\n${formatProblems(problems)}`);
  }
};

export default reportProblems;
