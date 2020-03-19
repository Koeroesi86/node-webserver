const service = require('os-service');
const minimist = require('minimist');
const { resolve } = require('path');
const { SERVICE_NAME } = require(process.env.NODE_WEBSERVER_CONFIG || '../configuration');
const { spawn } = require('child_process');

const { add, remove, run } = minimist(process.argv.slice(2));

let child;
process.chdir(__dirname);

if (add) {
  service.add(SERVICE_NAME, {
    programPath: resolve('./manageService.js'),
    programArgs: ["--run"]
  }, function (error) {
    if (error) {
      console.trace(error);
    }
  });
} else if (remove) {
  service.remove(SERVICE_NAME, function (error) {
    if (error) {
      console.trace(error);
    }
  });
} else if (run) {
  service.run(function () {
    if (child) {
      child.stdin.pause();
      child.kill();
      child = null;
    }
    process.kill(process.pid, 'SIGINT');
    service.stop(0);
  });

  child = spawn(
    'node',
    [ resolve(__dirname, './server.js') ],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
  );
} else {
  console.info(`
    Usage:
    
    yarn run service [argument]
    
    arguments:
        --add      Installs the service
        --remove   Removes the service
        --run      Attempt to run the program as a service
    `)
}
