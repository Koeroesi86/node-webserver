import ResponseEvent from '../classes/ResponseEvent';
import { EVENT_STARTED, EVENT_REQUEST, EVENT_RESPONSE, ENV_COMMUNICATION, ENV_HANDLER, ENV_PATH } from '../constants';
import { getRegisteredPath } from '../registry';
import sendToParent from '../utils/sendToParent';
import type RequestEvent from '../classes/RequestEvent';
import type { Communication, LambdaEvent, StorageDriverConstructor } from '../types';

type LambdaHandler = (event: RequestEvent, context: object, callback: (error?: unknown, response?: ResponseEvent) => void) => void;

const { [ENV_PATH]: lambdaPath = './testLambda.js', [ENV_HANDLER]: handlerKey = 'handler', [ENV_COMMUNICATION]: communicationJson = '{}' } = process.env;

const lambdaModule: Record<string, LambdaHandler> = require(lambdaPath);
const lambdaHandler = lambdaModule[handlerKey];
const communication: Communication = JSON.parse(communicationJson);
const Storage: StorageDriverConstructor = require(getRegisteredPath(communication.type));

setTimeout(() => {
  process.exit(0);
}, 15 * 60 * 1000); // setting to default 15 minutes AWS timeout 15 * 60 * 1000

/** what AWS answers for a failed function: the details go to the log of the lambda, not to the client */
const failure = (error: unknown) => {
  console.error(error);
  return Object.assign(new ResponseEvent(), { statusCode: 502, headers: { 'Content-Type': 'text/plain' }, body: 'Internal server error.' });
};

function messageListener(event: LambdaEvent) {
  if (event.type !== EVENT_REQUEST || event.id === undefined) return;

  const { id } = event;
  const storage = new Storage(id, process);

  Promise.resolve()
    .then(() => storage.getRequest())
    .then(
      (requestEvent) =>
        new Promise<ResponseEvent>((resolve) => {
          try {
            lambdaHandler(requestEvent, {}, (error, response = new ResponseEvent()) =>
              resolve(error ? failure(error) : Object.assign(new ResponseEvent(), response))
            );
          } catch (error) {
            // a handler that throws would take the process, and so the lambda, down with it
            resolve(failure(error));
          }
        })
    )
    .then((responseEvent) => storage.setResponse(responseEvent))
    .then(() => sendToParent({ type: EVENT_RESPONSE, id }));
}

process.on('message', (event) => {
  if (typeof event === 'object' && event !== null) {
    messageListener(event);
  }
});

// the parent can disappear without running its exit handlers, for example when it is terminated by a signal
process.on('disconnect', () => process.exit(0));

sendToParent({ type: EVENT_STARTED });
