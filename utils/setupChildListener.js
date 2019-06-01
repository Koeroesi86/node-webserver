const getDate = require('./getDate');

module.exports = child => {
  child.stdout.on('data', data => {
    console.info(`[${getDate()}] ${data.toString().trim()}`);
  });

  child.stderr.on('data', data => {
    console.warn(`[${getDate()}] ${data.toString().trim()}`);
  });

  child.on('close', code => {
    if (code) {
      console.error(`[${getDate()}] child process exited with code ${code}`);
    }
  });
};
