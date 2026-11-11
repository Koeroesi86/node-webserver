import createLambdaStats from './create-lambda-stats';

/** the stats of the middlewares that were not given a registry, which `getLambdaStats` reads */
export const defaultLambdaStats = createLambdaStats();

/** what the lambdas of the middlewares that were not given a registry of their own are doing right now. Prefer `createLambdaStats` for a server of its own. */
export const getLambdaStats = defaultLambdaStats.getStats;
