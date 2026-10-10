// two handlers of one file, which the routes of the lambda server send different paths to
const respond = (handler) => (event, context, callback) =>
  callback(null, {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'X-Pid': String(process.pid) },
    body: JSON.stringify({ handler, path: event.path, pathParameters: event.pathParameters }),
  });

exports.list = respond('list');
exports.get = respond('get');
