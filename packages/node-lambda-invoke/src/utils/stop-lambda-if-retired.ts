import type Lambda from '../classes/Lambda';
import { STOP_GRACE } from '../constants';

/** asks an idle lambda that has had its time to stop, and makes it when it does not */
const stopLambdaIfRetired = (instance: Lambda) => {
  if (!instance.retiring || instance.busy) return;

  instance.terminate('SIGTERM');
  const killTimer = setTimeout(() => instance.terminate('SIGKILL'), STOP_GRACE);
  killTimer.unref();
  instance.addEventListenerOnce('close', () => clearTimeout(killTimer));
};

export default stopLambdaIfRetired;
