const path = require('path');
const Worker = require('../classes/Worker');

const worker = new Worker(
  `node ${path.resolve(__dirname, '../example/script.js')}`,
  { stdio: 'inherit' }
);

process.once('exit', () => {
  worker.terminate();
});
