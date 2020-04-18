const express = require('express');
const { resolve } = require('path');
const http = require('http');
const parseArgv = require('../utils/parseArgv');

const { path, port } = parseArgv();

let currentPort = port || process.env.PORT;

if (!currentPort || !path) {
  throw new Error("Both port and path should be specified to serve.");
}

const resolved = resolve(path);

// create main app
const staticApp = express();
staticApp.use(express.static(resolved));
staticApp.disable('x-powered-by');
http.createServer(staticApp).listen(currentPort);
