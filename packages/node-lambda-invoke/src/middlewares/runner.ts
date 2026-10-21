import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { startWorkerProcess } from '@koeroesi86/node-worker/pool';
import { ENV_HANDLER, ENV_MAX_LIFETIME, ENV_PATH, LIFESPAN } from '../constants';
// every lambda process starts here, the index would load all of the utils of the package for it
/* eslint-disable no-restricted-imports */
import createLambdaWorker from '../utils/create-lambda-worker';
import findHandler from '../utils/find-handler';
/* eslint-enable no-restricted-imports */

const { [ENV_PATH]: lambdaPath = './testLambda.js', [ENV_HANDLER]: handlerKey = 'handler', [ENV_MAX_LIFETIME]: maxLifetime = `${LIFESPAN}` } = process.env;

// a safety net: the server stops a lambda when it is time, this is for when it does not, for example because it hangs
setTimeout(() => {
  process.exit(0);
}, Number(maxLifetime));

/** loads the module the way AWS does, CommonJS or an ES module that may use top-level await, then starts listening, so a lambda that cannot load never says it is ready */
async function main() {
  const namespace: unknown = await import(pathToFileURL(resolve(lambdaPath)).href);
  const found = findHandler(namespace, handlerKey);

  if (!found) throw new Error(`The handler ${handlerKey} was not found in ${lambdaPath}.`);

  startWorkerProcess(createLambdaWorker(found));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
