const { createHash } = require('crypto');

const defaultRounds = 8000;
const maxRounds = 500000;

// a worker that keeps its process busy, to see how requests are spread over the workers: it hashes the digest of the previous round
module.exports = (event, callback) => {
  const requested = Number(event.queryStringParameters.rounds);
  const rounds = Math.min(Number.isInteger(requested) && requested > 0 ? requested : defaultRounds, maxRounds);
  let digest = Buffer.from('node-webserver');

  for (let round = 0; round < rounds; round += 1) {
    digest = createHash('sha256').update(digest).digest();
  }

  callback({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rounds, digest: digest.toString('hex') }),
    isBase64Encoded: false,
  });
};
