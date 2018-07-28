const minimist = require('minimist');
const express = require('express');
const { resolve } = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

const { path, port, secureConfig } = minimist(process.argv.slice(2));

if (!port || !path) {
  throw new Error("Both port and path should be specified to serve.");
}

const resolved = resolve(path);

// create main app
const staticApp = express();

staticApp.use(express.static(resolved));

staticApp.disable('x-powered-by');

const startHttp = () => http.createServer(staticApp).listen(port);
const startHttps = (config) => https.createServer(config, staticApp).listen(port);

if (!secureConfig) {
  startHttp();
} else {
  const { key, cert, ca } = JSON.parse(secureConfig);

  if (key && cert) {
    const options = Object.assign({}, secureConfig, {
      key: fs.readFileSync(resolve(key)),
      cert: fs.readFileSync(resolve(cert))
    });

    if (ca) {
      if (fs.existsSync(resolve(ca))) {
        options.ca = fs.readFileSync(resolve(ca));
      } else {
        delete options.ca;
      }
    }

    startHttps(options);
  } else {
    startHttp();
  }
}

console.log(`Providing static files to "${resolved}" on port ${port}`);


