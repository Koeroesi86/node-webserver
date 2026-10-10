import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { EVENT_STARTED, EVENT_REQUEST, EVENT_RESPONSE, ENV_COMMUNICATION, ENV_HANDLER, ENV_PATH, DEFAULT_TIMEOUT } from '../constants';
import { getRegisteredPath } from '../registry';
import createContext from '../utils/create-context';
import findHandler from '../utils/find-handler';
import runHandler from '../utils/run-handler';
import sendToParent from '../utils/sendToParent';
import type { Communication, LambdaEvent, StorageDriverConstructor } from '../types';

const { [ENV_PATH]: lambdaPath = './testLambda.js', [ENV_HANDLER]: handlerKey = 'handler', [ENV_COMMUNICATION]: communicationJson = '{}' } = process.env;

setTimeout(() => {
  process.exit(0);
}, 15 * 60 * 1000); // setting to default 15 minutes AWS timeout 15 * 60 * 1000

function messageListener(event: LambdaEvent, handler: ReturnType<typeof findHandler> & object, Storage: StorageDriverConstructor) {
  if (event.type !== EVENT_REQUEST || event.id === undefined) return;

  const { id, deadline = Date.now() + DEFAULT_TIMEOUT } = event;
  const storage = new Storage(id, process);

  Promise.resolve()
    .then(() => storage.getRequest())
    .then((requestEvent) => runHandler(handler, requestEvent, (done) => createContext(id, deadline, done)))
    .then((responseEvent) => storage.setResponse(responseEvent))
    .then(() => sendToParent({ type: EVENT_RESPONSE, id }));
}

/** loads the module the way AWS does, CommonJS or an ES module that may use top-level await, then starts listening, so a lambda that cannot load never announces itself */
async function main() {
  const communication: Communication = JSON.parse(communicationJson);
  const Storage: StorageDriverConstructor = require(getRegisteredPath(communication.type));
  const namespace: unknown = await import(pathToFileURL(resolve(lambdaPath)).href);
  const handler = findHandler(namespace, handlerKey);

  if (!handler) throw new Error(`The handler ${handlerKey} was not found in ${lambdaPath}.`);

  process.on('message', (event) => {
    if (typeof event === 'object' && event !== null) {
      messageListener(event, handler, Storage);
    }
  });

  // the parent can disappear without running its exit handlers, for example when it is terminated by a signal
  process.on('disconnect', () => process.exit(0));

  sendToParent({ type: EVENT_STARTED });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
