// answers with the id of the item, from the parameters of a route or else from the last part of the path, so that a routed and a probed request do the same work
module.exports = (event, callback) => {
  const id = event.pathParameters?.id ?? event.pathFragments[event.pathFragments.length - 1];

  callback({
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    body: `item ${id}`,
    isBase64Encoded: false,
  });
};
