const worker = require(process.argv[2]);
process.on('message', event => {
  const callback = responseEvent => {
    process.send(responseEvent);
  };
  worker(event, callback);
});
