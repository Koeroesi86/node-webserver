const { WORKER_EVENT } = require('../constants');

const worker = require(process.argv[2]);
process.on('message', message => {
  if (message.type === WORKER_EVENT.REQUEST)  {
    process.send({
      type: WORKER_EVENT.REQUEST_ACKNOWLEDGE,
      requestId: message.requestId,
    });
    const callback = responseEvent => {
      process.send({
        type: WORKER_EVENT.RESPONSE,
        requestId: message.requestId,
        event: responseEvent,
      });
    };
    worker(message.event, callback);
  }
});
