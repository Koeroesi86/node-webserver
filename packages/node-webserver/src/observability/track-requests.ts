import type { RequestHandler } from 'express';

/** counts the requests the handler is answering, so that what runs behind it is only stopped once they are done. A listener for every request, so only where nothing behind knows. */
const trackRequests = (handler: RequestHandler): { handler: RequestHandler; idle: () => Promise<void> } => {
  let active = 0;
  let onIdle: (() => void) | undefined;
  const done = () => {
    active -= 1;
    if (active === 0) onIdle?.();
  };

  return {
    handler: (request, response, next) => {
      active += 1;
      // `on` with the one function rather than `once`, which wraps the listener for every request: a response closes once and is dropped after it
      response.on('close', done);
      handler(request, response, next);
    },
    idle: () => (active === 0 ? Promise.resolve() : new Promise<void>((resolve) => (onIdle = resolve))),
  };
};

export default trackRequests;
