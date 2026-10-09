const clamp = (value, fallback, max) => Math.min(Number.isInteger(value) && value > 0 ? value : fallback, max);

// made once per size, so that the worker is measured by sending a body and not by making one
const bodies = new Map();
const getBody = (size) => {
  if (!bodies.has(size)) {
    bodies.set(size, Buffer.from(Array.from({ length: size }, (_, index) => (index * 31) % 251)));
  }

  return bodies.get(size);
};

// a binary response of `size` bytes in one message, the byte with the number n has the value (n * 31) % 251, which is what the load test checks
module.exports = (event, callback) =>
  callback({
    statusCode: 200,
    headers: { 'Content-Type': 'application/octet-stream' },
    body: getBody(clamp(Number(event.queryStringParameters.size), 4096, 8 * 1024 * 1024)),
  });
