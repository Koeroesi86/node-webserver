// a health and a metrics endpoint: the worker asks the server for its metrics, as it lives in a process of its own
// /health answers 200, or 503 when requests wait for workers that cannot be started, /metrics gives everything the server knows
module.exports = async (event, callback) => {
  const metrics = await event.getMetrics();
  const json = (statusCode, body) => callback({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body), isBase64Encoded: false });

  if (event.path === '/metrics') {
    return json(200, metrics);
  }

  if (event.path === '/health') {
    const waiting = Object.values(metrics.sources).reduce((total, source) => total + (source && typeof source.waiting === 'number' ? source.waiting : 0), 0);

    return waiting > 0 ? json(503, { status: 'busy', waiting }) : json(200, { status: 'ok', uptimeSeconds: metrics.uptimeSeconds });
  }

  return json(404, { error: `${event.path} does not exist` });
};
