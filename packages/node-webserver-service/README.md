# node-webserver-service [![Build Status](https://travis-ci.com/Koeroesi86/node-webserver-service.svg?branch=master)](https://travis-ci.com/Koeroesi86/node-webserver-service)

OS service integration for @koeroesi86/node-webserver

This package brings ability to deploy webapps a lot easier. Just copy [configuration.example.js](configuration.example.js) to `configuration.js`, modify it to your needs and start server instantly. Configuration also supported in `configuration.json` format.

### Dependencies to run
* [NodeJS](https://nodejs.org/en/)
* [Yarn](https://yarnpkg.com/en/)
* For Windows usage
    1. [Python](https://www.python.org/)
    1. [Visual C++ Build Tools](https://www.visualstudio.com/downloads/#build-tools-for-visual-studio-2017)
    1. Windows build tools
     
        From an administrator console:

        ```shell script
        npm install --global --production windows-build-tools
       ```


### Usage

```shell script
yarn add @koeroesi86/node-webserver-service
```

Please enter in a console/terminal:

```shell script
yarn nws-service [argument]

arguments:
    --add      Installs the service
    --remove   Removes the service
    --run      Attempt to run the program as a service
```
