const { setTimeout: sleep } = require('timers/promises');
const { streamResponse } = require('@koeroesi86/node-worker-express');

// answers with its process and the front that started it. With `wait` it says so at once and finishes that many milliseconds later, for a request that is in flight
module.exports = async (event, callback) => {
  const wait = Number(event.queryStringParameters.wait || 0);

  if (!wait) {
    const body = JSON.stringify({ worker: process.pid, front: process.ppid });
    callback({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body, isBase64Encoded: false });
    return;
  }

  async function* generate() {
    yield 'started\n';
    await sleep(wait);
    yield 'finished\n';
  }

  await streamResponse(callback, { headers: { 'Content-Type': 'text/plain' } }, generate());
};
