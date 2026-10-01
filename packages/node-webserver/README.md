# NodeJS Web Server

This package brings ability to deploy webapps a lot easier. Just copy [configuration.example.js](configuration.example.js) to `configuration.js`, modify it to your needs and start server instantly. Configuration also supported in `configuration.json` format.

### Dependencies to run
* [NodeJS](https://nodejs.org/en/)
* [pnpm](https://pnpm.io/) (`corepack enable`)
* For Windows usage
    1. [Python](https://www.python.org/)
    1. [Visual C++ Build Tools](https://www.visualstudio.com/downloads/#build-tools-for-visual-studio-2017)
    1. Windows build tools
     
        From an administrator console:

        ```npm install --global --production windows-build-tools```


### Usage

Please enter in a console/terminal:
    
    pnpm install
    pnpm start


### Build

TODO: Set up tests for build

[![Build Status](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)
