// two handlers of one file, for the lambda servers of the load test that reach them with and without a table of routes: `/items/<id>` and `/orders`
exports.item = (event, context, callback) => {
  // the route of lambda-routes.localhost names the id, the single lambda of lambda-single.localhost only has the path
  const id = event.pathParameters?.id ?? event.path.split('/').pop();
  callback(null, { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: `item ${id}` });
};

exports.orders = (event, context, callback) => callback(null, { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: 'orders' });
