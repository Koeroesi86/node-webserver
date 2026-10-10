// A lambda for the load test of what goes wrong: /ok answers, /slow?ms=n answers after n milliseconds, /crash ends the process, /throw rejects.
module.exports.handler = async (event) => {
  if (event.path === '/crash') process.exit(1);
  if (event.path === '/throw') throw new Error('The handler failed.');

  const delay = Number(event.queryStringParameters?.ms ?? 0);
  if (delay > 0) await new Promise((done) => setTimeout(done, delay));

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, pid: process.pid }) };
};
