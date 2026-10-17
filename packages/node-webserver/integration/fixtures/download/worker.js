const streamResponse = require('@koeroesi86/node-worker-express/dist/streamResponse');

// a body of `kib` KiB with a Content-Length, which the server hands to the worker to write to the client itself
module.exports = async (event, callback) => {
  const size = Number(event.queryStringParameters.kib || 1) * 1024;

  await streamResponse(callback, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) } }, [Buffer.alloc(size, 'd')]);
};
