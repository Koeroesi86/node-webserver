import ResponseEvent from '../classes/ResponseEvent';
import { EVENT_STARTED, EVENT_REQUEST, EVENT_RESPONSE } from '../constants';
import { getRegisteredPath } from '../registry';
import sendToParent from '../utils/sendToParent';
import type RequestEvent from '../classes/RequestEvent';
import type { Communication, LambdaEvent, StorageDriverConstructor } from '../types';

type LambdaHandler = (event: RequestEvent, context: object, callback: (error?: unknown, response?: ResponseEvent) => void) => void;

const { LAMBDA = './testLambda.js', HANDLER = 'handler', COMMUNICATION = '{}' } = process.env;

const lambdaModule: Record<string, LambdaHandler> = require(LAMBDA);
const lambdaHandler = lambdaModule[HANDLER];
const communication: Communication = JSON.parse(COMMUNICATION);
const Storage: StorageDriverConstructor = require(getRegisteredPath(communication.type));

setTimeout(() => {
  process.exit(0);
}, 15 * 60 * 1000); // setting to default 15 minutes AWS timeout 15 * 60 * 1000

const getErrorBody = (error: unknown) => (typeof error === 'object' && error !== null && 'body' in error && error.body ? `${error.body}` : `${error}`);

function messageListener(event: LambdaEvent) {
  if (event.type !== EVENT_REQUEST || event.id === undefined) return;

  const { id } = event;
  const storage = new Storage(id, process);

  Promise.resolve()
    .then(() => storage.getRequest())
    .then(
      (requestEvent) =>
        new Promise<ResponseEvent>((resolve) => {
          lambdaHandler(requestEvent, {}, (error, response = new ResponseEvent()) => {
            const responseEvent = new ResponseEvent();

            if (error) {
              responseEvent.statusCode = 500;
              responseEvent.body = getErrorBody(error);
            } else {
              Object.assign(responseEvent, response);
            }

            resolve(responseEvent);
          });
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

sendToParent({ type: EVENT_STARTED });
