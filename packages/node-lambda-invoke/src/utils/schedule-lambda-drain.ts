import type Lambda from '../classes/Lambda';
import stopLambdaIfRetired from './stop-lambda-if-retired';
import { DRAIN_AFTER } from '../constants';
import type { Logger } from '../types';

/** a lambda that has had its time is stopped when it is free, a request that runs on it is let finish */
const scheduleLambdaDrain = (instance: Lambda, id: string, logger: Logger) => {
  const drainTimer = setTimeout(() => {
    instance.retire();
    logger(`[${id}] draining`);
    stopLambdaIfRetired(instance);
  }, DRAIN_AFTER);
  drainTimer.unref();
  instance.addEventListenerOnce('close', () => clearTimeout(drainTimer));
};

export default scheduleLambdaDrain;
