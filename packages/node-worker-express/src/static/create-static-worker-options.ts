import { StaticOptionsEnv } from '../constants';
import type { StaticOptions } from '../types';
import normalizeStaticOptions from './normalize-static-options';

/** The spawn options of the static worker, which reads its own options from the environment as JSON. Invalid ones throw, so that nothing was started yet. */
const createStaticWorkerOptions = (staticOptions: StaticOptions | undefined) => {
  const serialized = staticOptions && JSON.stringify(normalizeStaticOptions(staticOptions));

  return { cwd: process.cwd(), ...(serialized && { env: { ...process.env, [StaticOptionsEnv]: serialized } }) };
};

export default createStaticWorkerOptions;
