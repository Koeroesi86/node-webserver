import type { IncomingMessage } from 'http';

const methodsWithoutBody = ['GET', 'DELETE', 'OPTIONS', 'HEAD'];

/** requests of these methods have no body to read */
const hasBody = (request: IncomingMessage) => !methodsWithoutBody.includes(request.method?.toUpperCase() ?? 'GET');

export default hasBody;
