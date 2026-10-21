const streamResponse = require('@koeroesi86/node-worker-express').streamResponse;

const part = 1024 * 1024;
const clamp = (value, fallback, max) => Math.min(Number.isInteger(value) && value > 0 ? value : fallback, max);

// a download of `mib` MiB with a Content-Length, which is what makes the server hand the connection over to the worker: the bytes of the part with the number n all have the value n % 256,
// and the memory stays at one part, as the next one is made when the client took the one before
module.exports = async (event, callback) => {
  const parts = clamp(Number(event.queryStringParameters.mib), 32, 256);

  async function* generate() {
    for (let index = 0; index < parts; index += 1) {
      yield Buffer.alloc(part, index % 256);
    }
  }

  await streamResponse(callback, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(parts * part) } }, generate());
};
