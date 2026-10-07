const streamResponse = require('@koeroesi86/node-worker-express/dist/streamResponse');

const clamp = (value, fallback, max) => Math.min(Number.isInteger(value) && value > 0 ? value : fallback, max);

// a response that is generated while it is sent: `chunks` parts of `size` bytes, the bytes of the part with the number n all have the value n % 256
module.exports = async (event, callback) => {
  const chunks = clamp(Number(event.queryStringParameters.chunks), 8, 4096);
  const size = clamp(Number(event.queryStringParameters.size), 4096, 1024 * 1024);

  async function* generate() {
    for (let index = 0; index < chunks; index += 1) {
      yield Buffer.alloc(size, index % 256);
    }
  }

  await streamResponse(callback, { headers: { 'Content-Type': 'application/octet-stream', 'X-Chunks': String(chunks) } }, generate());
};
