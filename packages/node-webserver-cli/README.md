# @koeroesi86/node-webserver-cli

CLI for [@koeroesi86/node-webserver](../node-webserver).

### Dependencies to run
* [NodeJS](https://nodejs.org/en/)

### Usage:

```shell script
npm install @koeroesi86/node-webserver-cli
npx nws-cli --config </path/to/config>
```

To check a configuration and the server files it names without starting anything, for CI or before a deploy or a `SIGHUP`:

```shell script
npx nws-cli --config </path/to/config> --check
```

It prints every problem with its server and setting, and exits with 1 when there is an error. What is checked is in the [README of the server](../node-webserver/README.md#checking-the-configuration).
