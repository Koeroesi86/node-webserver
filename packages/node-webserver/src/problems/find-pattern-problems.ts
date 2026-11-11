import type { ConfigurationProblem } from '../types';

interface PatternRoute {
  pattern?: string;
  flags?: string;
}

const assertPattern = (pattern?: string, flags?: string) => {
  if (pattern !== undefined) new RegExp(pattern, flags);
};

/** the patterns of the routes that are not regular expressions, which would fail only when the server is created */
const findPatternProblems = (server: string, setting: string, routes: PatternRoute[] = []): ConfigurationProblem[] =>
  routes.flatMap(({ pattern, flags }, position): ConfigurationProblem[] => {
    try {
      assertPattern(pattern, flags);
      return [];
    } catch (error) {
      return [{ severity: 'error', server, setting: `${setting}[${position}].pattern`, message: error instanceof Error ? error.message : String(error) }];
    }
  });

export default findPatternProblems;
